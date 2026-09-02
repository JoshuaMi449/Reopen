// 托盘模块（macOS 专用）——参照业界 SwiftUI 菜单栏实现（2026-08-28 三图标对比实验定稿）：
//   图标=贴在状态栏按钮上的 NSHostingView（SwiftUI 视图，业界通行做法
//   addSubview(NSHostingView) 同款），换帧=SwiftUI 内部 .common RunLoop Timer
//   （业界通行做法）。实验实锤：只有 SwiftUI 管线能获得系统
//   「非活跃屏冻结最后一帧」托管——NSImageView 换图 / layer.contents 换帧在非活跃屏
//   都会跟着动（前几轮失败根因）。
//   SwiftUI 视图与模型在 native/src/tray_runner.swift（编译为 libtray_runner.dylib，
//   binding.gyp action 自动编译），本文件 dlopen 调用其 C 接口。
//   帧序列（JS 侧解码/模板化/缩放好的 PNG）与换帧间隔（CPU 变速）由 JS 传入。
//   深浅色：模板图由系统按每屏菜单栏外观着色（双屏一深一浅各屏正确）。
//   点击（左键按下即触发）经 ThreadSafeFunction 回调 JS。
#include <napi.h>
#import <Cocoa/Cocoa.h>
#include <dlfcn.h>
#include <cstring>
#include <string>
#include <chrono>
#include <mutex>
// SystemMonitor 依赖（业界开源 SystemInfoKit 同源 API）：
#include <mach/mach_host.h>
#import <IOKit/IOKitLib.h>
#include <ifaddrs.h>
#include <net/if.h>
#import <Network/Network.h>
#import <UserNotifications/UserNotifications.h>

static NSStatusItem *gStatusItem = nil;
static Napi::ThreadSafeFunction gTsFn = nullptr;

// Swift dylib 的 C 接口（native/src/tray_runner.swift）
static void *(*pTrModelCreate)(void) = nullptr;
static void (*pTrModelSetFrames)(void *, NSArray *, double, bool) = nullptr;
static void (*pTrModelSetInterval)(void *, double) = nullptr;
static void (*pTrModelSetInvert)(void *, bool, bool) = nullptr;
static void (*pTrModelSetFlip)(void *, bool) = nullptr;
static void (*pTrModelSetDark)(void *, bool) = nullptr;
static void *(*pTrViewCreate)(void *) = nullptr;
static void (*pTrDestroy)(void *) = nullptr;
static void *gRunnerModel = nullptr;   // RunnerModel 指针
static NSView *gHostingView = nil;     // 图标子视图（NSHostingView）

struct EventData {
  std::string type;  // "click" / "menu"
  std::string payload;
};

// 全局左键监视（面板显示期间启用：点击面板外任意处关闭面板，标准菜单栏交互）。
// global monitor 只观察不拦截（无需辅助功能权限，同类工具通行机制）。
static id gClickMonitor = nil;
static Napi::ThreadSafeFunction gClickTsFn = nullptr;

Napi::Value StartGlobalClickMonitor(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (gClickMonitor || info.Length() < 1 || !info[0].IsFunction()) return env.Undefined();
  gClickTsFn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(),
                                             "reopen-global-click", 0, 1);
  gClickMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown
                                                         handler:^(NSEvent *event) {
    if (!gClickTsFn) return;
    // mouseLocation 是 NS 屏幕坐标（原点主屏左下）→ 转 CG/Electron 系（原点主屏左上）
    NSPoint p = [NSEvent mouseLocation];
    CGFloat mainH = [NSScreen mainScreen].frame.size.height;
    std::string payload = std::to_string(p.x) + "," + std::to_string(mainH - p.y);
    auto *data = new EventData{"click", std::move(payload)};
    gClickTsFn.BlockingCall(data, [](Napi::Env env, Napi::Function cb, EventData *d) {
      cb.Call({Napi::String::New(env, d->type), Napi::String::New(env, d->payload)});
      delete d;
    });
  }];
  return env.Undefined();
}

Napi::Value StopGlobalClickMonitor(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (gClickMonitor) {
    [NSEvent removeMonitor:gClickMonitor];
    gClickMonitor = nil;
  }
  if (gClickTsFn) {
    gClickTsFn.Release();
    gClickTsFn = nullptr;
  }
  return env.Undefined();
}

// 通知授权查询（UNUserNotificationCenter）：一次性回调，payload =
// authorized（已允许）/ denied（已拒绝）/ notDetermined（没弹过授权窗）
Napi::Value GetNotificationAuth(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) return env.Undefined();
  auto *tsfn = new Napi::ThreadSafeFunction(
      Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(),
                                    "reopen-notif-auth", 0, 1));
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    NSString *result = @"notDetermined";
    if (settings.authorizationStatus == UNAuthorizationStatusAuthorized) {
      result = @"authorized";
    } else if (settings.authorizationStatus == UNAuthorizationStatusDenied) {
      result = @"denied";
    }
    auto *data = new EventData{"auth", [result UTF8String]};
    tsfn->BlockingCall(data, [](Napi::Env env, Napi::Function cb, EventData *d) {
      cb.Call({Napi::String::New(env, d->payload)});
      delete d;
    });
    tsfn->Release();
  }];
  return env.Undefined();
}

// 回调 JS（主线程安全）
static void EmitEvent(std::string type, std::string payload) {
  if (!gTsFn) return;
  auto *data = new EventData{std::move(type), std::move(payload)};
  gTsFn.BlockingCall(data, [](Napi::Env env, Napi::Function cb, EventData *d) {
    cb.Call({Napi::String::New(env, d->type), Napi::String::New(env, d->payload)});
    delete d;
  });
}

static void PushAppearance(void);

@interface StatusItemTarget : NSObject
@end
@implementation StatusItemTarget
// 按钮视图 effectiveAppearance / window 变化（viewDidChangeEffectiveAppearance 机制
//   触发时机）：视图外观沿继承链变化（含窗口换屏、外观切换）时推送。取值源在
//   PushAppearance 里统一走 button.window.effectiveAppearance（同款数据源）。
- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary *)change
                       context:(void *)context {
  if ([keyPath isEqualToString:@"effectiveAppearance"] ||
      [keyPath isEqualToString:@"window"]) {
    PushAppearance();
  }
}

// 左键按下即触发（用户要求：不等 mouseUp）。右键无功能（2026-09-01 用户拍板：
// 右键菜单与面板内「打开主窗口/偏好设置/退出」重复，移除）
- (void)clicked:(id)sender {
  NSEvent *e = [NSApp currentEvent];
  if (e.type == NSEventTypeLeftMouseDown) {
    EmitEvent("click", "left");
  }
}
@end
static StatusItemTarget *gTarget = nil;

// 把菜单栏窗口当前外观推给 Swift 侧（StatusBarAppearanceBridge 同款数据源）：
//   取值源=button.window.effectiveAppearance——只用于双色 GIF 的反转判定（mono 静态
//   主题图标走系统模板图渲染，不经此路径）。窗口暂不存在时保持上次值——8-28 黑根因
//   =窗口 nil 时回退 NSApp=Aqua 判浅色。日志实测（2026-08-31）：此源跟随系统外观设置
//   （用户设浅色=Aqua），软件从任何公开 API 都拿不到壁纸明暗——mono 因此回归系统
//   模板图渲染（button.image，系统按每屏壁纸着色+非活跃自动灰）。
static void PushAppearance(void) {
  if (!gStatusItem || !gRunnerModel) return;
  NSWindow *w = gStatusItem.button.window;
  NSAppearance *ap = w.effectiveAppearance;
  if (!ap) {
    NSLog(@"[reopen-native] appearance: window/appearance nil — keep last values");
    return;
  }
  NSString *match = [ap
      bestMatchFromAppearancesWithNames:@[ NSAppearanceNameAqua, NSAppearanceNameDarkAqua ]];
  BOOL isDark = [match isEqualToString:NSAppearanceNameDarkAqua];
  __block NSColor *tc = nil;
  [ap performAsCurrentDrawingAppearance:^{
    tc = NSColor.textColor;
  }];
  NSColor *rgb = tc ? [tc colorUsingColorSpace:[NSColorSpace sRGBColorSpace]] : nil;
  double gray = rgb
      ? (rgb.redComponent + rgb.greenComponent + rgb.blueComponent) / 3.0
      : -1.0;
  if (pTrModelSetDark) pTrModelSetDark(gRunnerModel, isDark);
  // 诊断日志：每次推送打印深浅/文字灰度/窗口指针（切活跃·非活跃后核对数值）
  NSLog(@"[reopen-native] appearance: isDark=%d gray=%.2f win=%p", isDark, gray, (__bridge void *)w);
}

// createStatusItem(callback)：创建托盘按钮+点击事件
Napi::Value CreateStatusItem(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "createStatusItem: expected callback").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  gTsFn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "reopen-tray-events", 0, 1);
  // 长度固定 22pt（业界通行）：所有 GIF 占位一致；自适应长度算不出
  //  addSubview 的 hostingView 宽度，会偏窄导致图标右边被相邻内容遮挡（裁剪根因）
  gStatusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:22];
  gStatusItem.button.title = @"";
  gTarget = [[StatusItemTarget alloc] init];
  gStatusItem.button.target = gTarget;
  gStatusItem.button.action = @selector(clicked:);
  [gStatusItem.button sendActionOn:NSEventMaskLeftMouseDown];
  // 全程纯菜单栏应用身份（LSUIElement 身份）：
  // 无 Dock、不进 Cmd+Tab、不抢焦点
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  return env.Undefined();
}

// initTrayRunner(dylibPath)：加载 SwiftUI 渲染模块，创建模型+视图挂到状态栏按钮
Napi::Value InitTrayRunner(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!gStatusItem || info.Length() < 1 || !info[0].IsString()) return env.Undefined();
  std::string path = info[0].As<Napi::String>().Utf8Value();
  void *handle = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (!handle) {
    NSLog(@"[reopen-native] dlopen failed: %s", dlerror());
    return env.Undefined();
  }
  pTrModelCreate = reinterpret_cast<void *(*)(void)>(dlsym(handle, "tr_model_create"));
  pTrModelSetFrames = reinterpret_cast<void (*)(void *, NSArray *, double, bool)>(
      dlsym(handle, "tr_model_set_frames"));
  pTrModelSetInterval = reinterpret_cast<void (*)(void *, double)>(dlsym(handle, "tr_model_set_interval"));
  pTrModelSetInvert = reinterpret_cast<void (*)(void *, bool, bool)>(dlsym(handle, "tr_model_set_invert"));
  pTrModelSetFlip = reinterpret_cast<void (*)(void *, bool)>(dlsym(handle, "tr_model_set_flip"));
  pTrModelSetDark = reinterpret_cast<void (*)(void *, bool)>(dlsym(handle, "tr_model_set_dark"));
  pTrViewCreate = reinterpret_cast<void *(*)(void *)>(dlsym(handle, "tr_view_create"));
  pTrDestroy = reinterpret_cast<void (*)(void *)>(dlsym(handle, "tr_destroy"));
  if (!pTrModelCreate || !pTrModelSetFrames || !pTrModelSetInterval || !pTrModelSetInvert ||
      !pTrModelSetFlip || !pTrModelSetDark || !pTrViewCreate || !pTrDestroy) {
    NSLog(@"[reopen-native] dlsym failed: %s", dlerror());
    return env.Undefined();
  }
  gRunnerModel = pTrModelCreate();
  void *viewPtr = pTrViewCreate(gRunnerModel);
  gHostingView = (__bridge NSView *)viewPtr;
  [gStatusItem.button addSubview:gHostingView];  // 业界通行做法
  // 监听按钮视图外观变化（viewDidChangeEffectiveAppearance 机制触发时机；
  //   NSView.effectiveAppearance 是 KVO 兼容属性，Initial 立即推一次消除空窗）
  //   与按钮归属窗口变化（双屏切换时换窗重推）。
  //   2026-08-31 重做：取值源统一在 PushAppearance 走窗口外观，这里只负责触发
  [gStatusItem.button addObserver:gTarget forKeyPath:@"effectiveAppearance"
                         options:(NSKeyValueObservingOptionInitial | NSKeyValueObservingOptionNew)
                         context:nullptr];
  [gStatusItem.button addObserver:gTarget forKeyPath:@"window"
                         options:NSKeyValueObservingOptionNew context:nullptr];
  return env.Undefined();
}

// setFrames(pngBuffers: Buffer[], isTemplate: boolean, intervalMs: number, box: boolean)：
//   帧序列（JS 已解码/缩放到 2x 像素）→ NSImage 数组（尺寸减半为 pt）→
//   Swift 侧换帧模型。换帧由 Swift .common Timer 驱动。
//   box=方框拉伸显示（非正方形素材等 .resizable() 拉伸；否则保持原比例居中）。
Napi::Value SetFrames(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!gStatusItem || !gRunnerModel || !pTrModelSetFrames || info.Length() < 4 ||
      !info[0].IsArray() || !info[1].IsBoolean() || !info[2].IsNumber() || !info[3].IsBoolean())
    return env.Undefined();
  Napi::Array arr = info[0].As<Napi::Array>();
  BOOL isTemplate = info[1].As<Napi::Boolean>().Value();
  double intervalMs = info[2].As<Napi::Number>().DoubleValue();
  bool box = info[3].As<Napi::Boolean>().Value();
  NSMutableArray *images = [NSMutableArray array];
  for (uint32_t i = 0; i < arr.Length(); i++) {
    Napi::Value v = arr.Get(i);
    if (!v.IsBuffer()) continue;
    Napi::Buffer<uint8_t> buf = v.As<Napi::Buffer<uint8_t>>();
    NSData *data = [NSData dataWithBytes:buf.Data() length:buf.Length()];
    NSImage *img = [[NSImage alloc] initWithData:data];
    if (!img) continue;
    // 帧 PNG 是 2x 像素（如 44px 高）——NSImage 默认按 1x 解释（44pt=菜单栏巨图），尺寸减半为 pt
    NSSize s = img.size;
    img.size = NSMakeSize(s.width / 2.0, s.height / 2.0);
    [img setTemplate:isTemplate];
    [images addObject:img];
  }
  if (images.count == 0) return env.Undefined();
  gStatusItem.length = 22;  // 固定 22pt（见 CreateStatusItem 注释）
  if (isTemplate) {
    // mono 主题图标（静态单帧）：走系统模板图渲染——button.image=template NSImage，
    //   系统按每屏壁纸自动着色（暗壁纸→白/亮壁纸→黑）+ 非活跃屏自动变灰，
    //   软件零干预（8-27 实测验证机制；软件取色永远拿不到壁纸明暗，8-31 日志实锤）
    NSImage *img = images[0];
    [img setTemplate:YES];
    gStatusItem.button.image = img;
    gHostingView.hidden = YES;
  } else {
    // 双色 GIF：SwiftUI 管线换帧（非活跃屏冻结最后一帧的唯一可行管线）
    gStatusItem.button.image = nil;
    gHostingView.hidden = NO;
    pTrModelSetFrames(gRunnerModel, images, intervalMs, box);
  }
  // 保险推：JS 换图标（mono↔GIF 切换）后立即推当前外观，不依赖 KVO 时机
  PushAppearance();
  return env.Undefined();
}

// setInterval(intervalMs: number)：换帧间隔更新（CPU 变速，JS 每 2s 采样后调用）
Napi::Value SetInterval(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!gRunnerModel || !pTrModelSetInterval || info.Length() < 1 || !info[0].IsNumber())
    return env.Undefined();
  double ms = info[0].As<Napi::Number>().DoubleValue();
  pTrModelSetInterval(gRunnerModel, ms);
  return env.Undefined();
}

// setInvert(light: boolean, dark: boolean)：反转配置（亮色反转/暗色反转——
//   Swift 侧 RunnerView 按当前菜单栏外观决定 colorInvert，外观切换自动响应
Napi::Value SetInvert(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!gRunnerModel || !pTrModelSetInvert || info.Length() < 2 ||
      !info[0].IsBoolean() || !info[1].IsBoolean())
    return env.Undefined();
  bool light = info[0].As<Napi::Boolean>().Value();
  bool dark = info[1].As<Napi::Boolean>().Value();
  pTrModelSetInvert(gRunnerModel, light, dark);
  return env.Undefined();
}

// setFlip(flipped: boolean)：水平翻转（RunCat Runner Flip 同款：显示层镜像帧）
Napi::Value SetFlip(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (!gRunnerModel || !pTrModelSetFlip || info.Length() < 1 || !info[0].IsBoolean())
    return env.Undefined();
  pTrModelSetFlip(gRunnerModel, info[0].As<Napi::Boolean>().Value());
  return env.Undefined();
}

// getFrame() → { x, y, w, h }：按钮全局坐标（顶部原点，与 Electron setPosition 同系，面板定位用）
Napi::Object GetFrame(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Object o = Napi::Object::New(env);
  if (!gStatusItem) {
    o.Set("x", 0); o.Set("y", 0); o.Set("w", 0); o.Set("h", 0);
    return o;
  }
  NSRect r = [gStatusItem.button.window convertRectToScreen:gStatusItem.button.bounds];
  // NS 坐标（原点主屏左下）→ CG/Electron 坐标（原点主屏左上）：
  // y_cg = 主屏高度 - y_ns - h（主屏高度是转换基准，不是所有屏 NSMaxY 最大值）
  CGFloat mainH = [NSScreen mainScreen].frame.size.height;
  o.Set("x", r.origin.x);
  o.Set("y", mainH - r.origin.y - r.size.height);
  o.Set("w", r.size.width);
  o.Set("h", r.size.height);
  return o;
}

// setPanelBehavior(handle: Buffer)：面板窗口设为「显示时移到活跃 Space」——每次弹出出现在
// 当前桌面，不再闪回创建时的旧桌面（同类托盘工具通行交互）。
// 注意：CanJoinAllSpaces 与 MoveToActiveSpace 互斥（同设会 NSInternalInconsistencyException 崩溃）
Napi::Value SetPanelBehavior(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) return env.Undefined();
  Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
  // handle 的 Buffer「内容」是 NSView* 指针值（Electron getNativeWindowHandle 语义），
  // 不是 Buffer 内存地址——必须 memcpy 取出指针值再 bridge
  if (buf.Length() < sizeof(void *)) return env.Undefined();
  void *ptr = nullptr;
  memcpy(&ptr, buf.Data(), sizeof(ptr));
  NSView *view = (__bridge NSView *)ptr;
  NSWindow *win = view.window;
  if (win) {
    win.collectionBehavior = NSWindowCollectionBehaviorMoveToActiveSpace;
  }
  return env.Undefined();
}

// destroyStatusItem()：退出前清理（子视图随按钮移除自动销毁）；
// 托盘销毁=恢复常规应用身份（否则 Dock 不回来，用户失去入口）
Napi::Value DestroyStatusItem(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (gStatusItem) {
    // 先摘外观观察（视图还活着时摘，防 removeStatusItem 后野指针）
    if (gTarget) {
      @try {
        [gStatusItem.button removeObserver:gTarget forKeyPath:@"effectiveAppearance"];
      } @catch (NSException *e) { /* 未注册时忽略 */ }
      @try {
        [gStatusItem.button removeObserver:gTarget forKeyPath:@"window"];
      } @catch (NSException *e) { /* 未注册时忽略 */ }
    }
    [[NSStatusBar systemStatusBar] removeStatusItem:gStatusItem];
    gStatusItem = nil;
    gHostingView = nil;
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  }
  if (gRunnerModel && pTrDestroy) {
    pTrDestroy(gRunnerModel);
    gRunnerModel = nullptr;
  }
  if (gClickMonitor) {
    [NSEvent removeMonitor:gClickMonitor];
    gClickMonitor = nil;
  }
  if (gClickTsFn) {
    gClickTsFn.Release();
    gClickTsFn = nullptr;
  }
  return env.Undefined();
}

// ============================================================
// SystemMonitor：面板同款系统信息采集。
// 数据来源 1:1 对齐业界开源 SystemInfoKit 库：
//   CPU   → Mach host_statistics64(HOST_CPU_LOAD_INFO)，两次调用 tick 差（CPURepository.swift:32 同款）
//   内存  → Mach host_statistics64(HOST_VM_INFO64)+host_info(HOST_BASIC_INFO)（MemoryRepository.swift:51 同款公式）
//   储存  → NSURL 资源值 TotalCapacity/AvailableCapacityForImportantUsage，根卷 "/"（StorageRepository.swift:20 同款）
//   电池  → IOKit 服务 AppleSmartBattery（旧键 + macOS 27 BatteryData 新键双路径探测，BatteryRepository.swift:43 同款）
//   网络  → NWPathMonitor 主接口 + getifaddrs 全接口字节差÷间隔=速度（NetworkRepository.swift:78 同款）
// 采样节奏：JS 主进程每 2s 调一次 getSystemInfo()（业界通行默认 5s）。
// CPU 百分比与网速都是「两次采样之间发生的量」：原生侧保存上一帧基准做差值。
// ============================================================

static host_cpu_load_info_data_t gPrevCpu = {};
static bool gHasPrevCpu = false;
static uint64_t gPrevNetBytes[2] = {0, 0};  // [0]=下载(ifi_ibytes) [1]=上传(ifi_obytes)
static bool gHasPrevNet = false;
static std::chrono::steady_clock::time_point gPrevNetTime;

// NWPathMonitor 主接口（NetworkRepository currentAvailableInterfaceTypes().first 同款）
static nw_path_monitor_t gPathMonitor = nullptr;
static std::string gPrimaryInterface;  // 接口名（en0 等）
static std::string gPrimaryType;       // "wifi"/"ethernet"/"cellular"/"loopback"/"unknown"
static std::mutex gNetMutex;

static void EnsurePathMonitor() {
  if (gPathMonitor) return;
  gPathMonitor = nw_path_monitor_create();
  nw_path_monitor_set_queue(gPathMonitor,
                            dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0));
  nw_path_monitor_set_update_handler(gPathMonitor, ^(nw_path_t path) {
    __block std::string name;
    __block std::string type = "unknown";
    nw_path_enumerate_interfaces(path, ^bool(nw_interface_t iface) {
      nw_interface_type_t t = nw_interface_get_type(iface);
      switch (t) {
        case nw_interface_type_wifi: type = "wifi"; break;
        case nw_interface_type_wired: type = "ethernet"; break;
        case nw_interface_type_cellular: type = "cellular"; break;
        case nw_interface_type_loopback: type = "loopback"; break;
        default: type = "unknown";
      }
      if (t == nw_interface_type_wifi || t == nw_interface_type_wired ||
          t == nw_interface_type_cellular) {
        const char *n = nw_interface_get_name(iface);
        if (n) name = n;
        return false;  // 第一个真实接口即主接口
      }
      return true;
    });
    std::lock_guard<std::mutex> lock(gNetMutex);
    gPrimaryInterface = name;
    gPrimaryType = type;
  });
  nw_path_monitor_start(gPathMonitor);
}

// IOKit 服务属性字典（BatteryRepository fetchIOServiceProperties 同款）
static NSDictionary *IOServiceProps(const char *name) {
  io_service_t service =
      IOServiceGetMatchingService(kIOMainPortDefault, IOServiceNameMatching(name));
  if (service == IO_OBJECT_NULL) return nil;
  CFMutableDictionaryRef props = nullptr;
  kern_return_t kr = IORegistryEntryCreateCFProperties(service, &props, kCFAllocatorDefault, 0);
  IOObjectRelease(service);
  if (kr != KERN_SUCCESS || !props) return nil;
  return (__bridge_transfer NSDictionary *)props;
}

static double DictDouble(NSDictionary *d, NSString *k, double def = 0) {
  if (!d) return def;
  NSNumber *n = d[k];
  return n ? n.doubleValue : def;
}

// getSystemInfo() → {
//   cpu:    { percent, system, user, idle }                      （比例 0-1）
//   memory: { percent, appBytes, wiredBytes, compressedBytes }   （bytes）
//   storage:{ percent, totalBytes, usedBytes }                   （bytes，根卷）
//   battery:{ installed, percent, maxCapacity, cycleCount, temperature, charging, adapterName }
//   network:{ type, ip, downloadBps, uploadBps }
// }
Napi::Value GetSystemInfo(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);
  Napi::Object cpu = Napi::Object::New(env);
  Napi::Object memory = Napi::Object::New(env);
  Napi::Object storage = Napi::Object::New(env);
  Napi::Object battery = Napi::Object::New(env);
  Napi::Object network = Napi::Object::New(env);

  // ---- CPU：两次调用间 user/system/idle/nice tick 差占比 ----
  host_cpu_load_info_data_t load;
  mach_msg_type_number_t cnt = HOST_CPU_LOAD_INFO_COUNT;
  if (host_statistics64(mach_host_self(), HOST_CPU_LOAD_INFO, (host_info64_t)&load, &cnt) ==
      KERN_SUCCESS) {
    double user = 0, system = 0, idle = 0;
    if (gHasPrevCpu) {
      double userDiff = (double)load.cpu_ticks[CPU_STATE_USER] - gPrevCpu.cpu_ticks[CPU_STATE_USER];
      double sysDiff = (double)load.cpu_ticks[CPU_STATE_SYSTEM] - gPrevCpu.cpu_ticks[CPU_STATE_SYSTEM];
      double idleDiff = (double)load.cpu_ticks[CPU_STATE_IDLE] - gPrevCpu.cpu_ticks[CPU_STATE_IDLE];
      double niceDiff = (double)load.cpu_ticks[CPU_STATE_NICE] - gPrevCpu.cpu_ticks[CPU_STATE_NICE];
      double total = userDiff + sysDiff + idleDiff + niceDiff;
      if (total > 0) {
        user = userDiff / total;
        system = sysDiff / total;
        idle = idleDiff / total;
      }
    }
    gPrevCpu = load;
    gHasPrevCpu = true;
    cpu.Set("percent", std::min(system + user, 0.999));
    cpu.Set("system", system);
    cpu.Set("user", user);
    cpu.Set("idle", idle);
  }

  // ---- 内存：vm_statistics64 页数 × 页大小（MemoryRepository 同款公式）----
  vm_statistics64_data_t vm;
  cnt = HOST_VM_INFO64_COUNT;
  vm_size_t pageSize = 0;
  host_basic_info_data_t basic;
  mach_msg_type_number_t bcnt = HOST_BASIC_INFO_COUNT;
  double maxMem = 0;
  if (host_info(mach_host_self(), HOST_BASIC_INFO, (host_info_t)&basic, &bcnt) == KERN_SUCCESS) {
    maxMem = (double)basic.max_mem;
  }
  if (host_statistics64(mach_host_self(), HOST_VM_INFO64, (host_info64_t)&vm, &cnt) ==
          KERN_SUCCESS &&
      host_page_size(mach_host_self(), &pageSize) == KERN_SUCCESS && pageSize > 0 && maxMem > 0) {
    double active = vm.active_count, inactive = vm.inactive_count;
    double speculative = vm.speculative_count, wired = vm.wire_count;
    double compressed = vm.compressor_page_count, purgeable = vm.purgeable_count;
    double external = vm.external_page_count;
    double cached = purgeable + external;
    double app = active + inactive + speculative - cached;
    double pressure = wired + compressed;
    double usingMem = app + pressure;
    memory.Set("percent", std::min(usingMem * pageSize / maxMem, 0.999));
    memory.Set("pressure", std::min(pressure * pageSize / maxMem, 0.999));
    memory.Set("appBytes", app * pageSize);
    memory.Set("wiredBytes", wired * pageSize);
    memory.Set("compressedBytes", compressed * pageSize);
  }

  // ---- 储存：根卷资源值（系统卷，非全部磁盘）----
  NSDictionary *vol =
      [[NSURL fileURLWithPath:@"/"]
          resourceValuesForKeys:@[ NSURLVolumeTotalCapacityKey,
                                   NSURLVolumeAvailableCapacityForImportantUsageKey ]
                          error:nil];
  double totalBytes = DictDouble(vol, NSURLVolumeTotalCapacityKey);
  double availBytes = DictDouble(vol, NSURLVolumeAvailableCapacityForImportantUsageKey);
  if (totalBytes > 0) {
    storage.Set("percent", std::min((totalBytes - availBytes) / totalBytes, 0.999));
    storage.Set("totalBytes", totalBytes);
    storage.Set("usedBytes", totalBytes - availBytes);
  }

  // ---- 电池：AppleSmartBattery（macOS 27 新键优先，旧键兜底）----
  NSDictionary *bat = IOServiceProps("AppleSmartBattery");
  if (bat && [bat[@"BatteryInstalled"] intValue] == 1) {
    battery.Set("installed", true);
    // 电量：顶层 CurrentCapacity（0-100 百分数，macOS 26 实测存在）优先；
    //   macOS 27 移进 BatteryData.CurrentCapacity 时兜底。
    // 最大容量：顶层 AppleRawMaxCapacity/DesignCapacity（mAh）优先，27 新键 FullChargeCapacity 兜底。
    // 温度：顶层 Temperature（0.01°C）优先，27 挪到 AppleSmartBatteryPack.BatteryData 兜底。
    NSDictionary *bdata = bat[@"BatteryData"];
    double cur = DictDouble(bat, @"CurrentCapacity");
    if (cur <= 0) cur = DictDouble(bdata, @"CurrentCapacity");
    if (cur > 0) battery.Set("percent", std::min(cur / 100.0, 1.0));
    double rawMax = DictDouble(bat, @"AppleRawMaxCapacity");
    double design = DictDouble(bat, @"DesignCapacity");
    if (rawMax <= 0) rawMax = DictDouble(bdata, @"FullChargeCapacity");
    if (design <= 0) design = DictDouble(bdata, @"DesignCapacity");
    if (design > 0) battery.Set("maxCapacity", std::min(rawMax / design, 1.0));
    double temp = DictDouble(bat, @"Temperature");
    if (temp <= 0) {
      NSDictionary *pack = IOServiceProps("AppleSmartBatteryPack");
      temp = DictDouble((NSDictionary *)pack[@"BatteryData"], @"Temperature");
    }
    if (temp > 0) battery.Set("temperature", temp / 100.0);
    if (bat[@"CycleCount"]) battery.Set("cycleCount", [bat[@"CycleCount"] intValue]);
    battery.Set("charging", [bat[@"IsCharging"] intValue] == 1);
    if ([bat[@"ExternalConnected"] intValue] == 1) {
      NSDictionary *adapter = bat[@"AdapterDetails"];
      NSString *name = adapter[@"Name"];
      int watts = [adapter[@"Watts"] intValue];
      if (name.length > 0) battery.Set("adapterName", name.UTF8String);
      else if (watts > 0) battery.Set("adapterName", (std::to_string(watts) + "W 电源适配器").c_str());
      else battery.Set("adapterName", "电源适配器");
    }
  } else {
    battery.Set("installed", false);  // 台式机无电池：面板显示「电池：未安装」
  }

  // ---- 网络：全接口累计字节差÷间隔=速度；主接口名匹配 IPv4 ----
  EnsurePathMonitor();
  {
    std::lock_guard<std::mutex> lock(gNetMutex);
    network.Set("type", gPrimaryType);
  }
  std::string primary;
  {
    std::lock_guard<std::mutex> lock(gNetMutex);
    primary = gPrimaryInterface;
  }
  struct ifaddrs *ifap = nullptr;
  double totalIn = 0, totalOut = 0;
  if (getifaddrs(&ifap) == 0) {
    for (struct ifaddrs *p = ifap; p; p = p->ifa_next) {
      if (!p->ifa_addr) continue;
      if (p->ifa_addr->sa_family == AF_LINK) {
        struct if_data *d = (struct if_data *)p->ifa_data;
        totalIn += d->ifi_ibytes;
        totalOut += d->ifi_obytes;
      } else if (!primary.empty() && p->ifa_addr->sa_family == AF_INET &&
                 primary == p->ifa_name) {
        char host[NI_MAXHOST] = {0};
        if (getnameinfo(p->ifa_addr, p->ifa_addr->sa_len, host, sizeof(host), nullptr, 0,
                        NI_NUMERICHOST) == 0) {
          network.Set("ip", host);
        }
      }
    }
    freeifaddrs(ifap);
  }
  auto now = std::chrono::steady_clock::now();
  double downloadBps = 0, uploadBps = 0;
  if (gHasPrevNet) {
    double sec = std::chrono::duration<double>(now - gPrevNetTime).count();
    if (sec > 0.1) {
      downloadBps = (totalIn - gPrevNetBytes[0]) / sec;
      uploadBps = (totalOut - gPrevNetBytes[1]) / sec;
    }
  }
  gPrevNetBytes[0] = totalIn;
  gPrevNetBytes[1] = totalOut;
  gPrevNetTime = now;
  gHasPrevNet = true;
  network.Set("downloadBps", downloadBps);
  network.Set("uploadBps", uploadBps);

  out.Set("cpu", cpu);
  out.Set("memory", memory);
  out.Set("storage", storage);
  out.Set("battery", battery);
  out.Set("network", network);
  return out;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createStatusItem", Napi::Function::New(env, CreateStatusItem));
  exports.Set("initTrayRunner", Napi::Function::New(env, InitTrayRunner));
  exports.Set("setFrames", Napi::Function::New(env, SetFrames));
  exports.Set("setInterval", Napi::Function::New(env, SetInterval));
  exports.Set("setInvert", Napi::Function::New(env, SetInvert));
  exports.Set("setFlip", Napi::Function::New(env, SetFlip));
  exports.Set("getFrame", Napi::Function::New(env, GetFrame));
  exports.Set("setPanelBehavior", Napi::Function::New(env, SetPanelBehavior));
  exports.Set("startGlobalClickMonitor", Napi::Function::New(env, StartGlobalClickMonitor));
  exports.Set("stopGlobalClickMonitor", Napi::Function::New(env, StopGlobalClickMonitor));
  exports.Set("getNotificationAuth", Napi::Function::New(env, GetNotificationAuth));
  exports.Set("getSystemInfo", Napi::Function::New(env, GetSystemInfo));
  exports.Set("destroyStatusItem", Napi::Function::New(env, DestroyStatusItem));
  return exports;
}

NODE_API_MODULE(reopen_native, Init)
