// 托盘模块（macOS 专用）——严格照抄 BuZhiYin 机制（2026-08-28 三图标对比实验定稿）：
//   图标=贴在状态栏按钮上的 NSHostingView（SwiftUI 视图，BuZhiYin 🐔App.swift:70
//   addSubview(NSHostingView) 同款），换帧=SwiftUI 内部 .common RunLoop Timer
//   （BuZhiYin 🐔View.swift:48 同款）。实验实锤：只有 SwiftUI 管线能获得系统
//   「非活跃屏冻结最后一帧」托管——NSImageView 换图 / layer.contents 换帧在非活跃屏
//   都会跟着动（前几轮失败根因）。
//   SwiftUI 视图与模型在 native/src/tray_runner.swift（编译为 libtray_runner.dylib，
//   binding.gyp action 自动编译），本文件 dlopen 调用其 C 接口。
//   帧序列（JS 侧解码/模板化/缩放好的 PNG）与换帧间隔（CPU 变速）由 JS 传入。
//   深浅色：模板图由系统按每屏菜单栏外观着色（双屏一深一浅各屏正确）。
//   点击（左键按下即触发/右键菜单）经 ThreadSafeFunction 回调 JS。
#include <napi.h>
#import <Cocoa/Cocoa.h>
#include <dlfcn.h>
#include <cstring>
#include <string>

static NSStatusItem *gStatusItem = nil;
static Napi::ThreadSafeFunction gTsFn = nullptr;

// Swift dylib 的 C 接口（native/src/tray_runner.swift）
static void *(*pTrModelCreate)(void) = nullptr;
static void (*pTrModelSetFrames)(void *, NSArray *, double, bool) = nullptr;
static void (*pTrModelSetInterval)(void *, double) = nullptr;
static void (*pTrModelSetInvert)(void *, bool, bool) = nullptr;
static void *(*pTrViewCreate)(void *) = nullptr;
static void (*pTrDestroy)(void *) = nullptr;
static void *gRunnerModel = nullptr;   // RunnerModel 指针
static NSView *gHostingView = nil;     // 图标子视图（NSHostingView）

struct EventData {
  std::string type;  // "click" / "menu"
  std::string payload;
};

// 全局左键监视（面板显示期间启用：点击面板外任意处关闭面板，标准菜单栏交互）。
// global monitor 只观察不拦截（无需辅助功能权限，BuZhiYin/LookAway 同款机制）。
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

// 回调 JS（主线程安全）
static void EmitEvent(std::string type, std::string payload) {
  if (!gTsFn) return;
  auto *data = new EventData{std::move(type), std::move(payload)};
  gTsFn.BlockingCall(data, [](Napi::Env env, Napi::Function cb, EventData *d) {
    cb.Call({Napi::String::New(env, d->type), Napi::String::New(env, d->payload)});
    delete d;
  });
}

@interface StatusItemTarget : NSObject
@end
@implementation StatusItemTarget
- (void)clicked:(id)sender {
  NSEvent *e = [NSApp currentEvent];
  if (e.type == NSEventTypeRightMouseDown) {
    [self showContextMenu];
    return;
  }
  // 左键按下即触发（用户要求：不等 mouseUp）
  if (e.type == NSEventTypeLeftMouseDown) {
    EmitEvent("click", "left");
  }
}

// 右键菜单：原生 NSMenu（popUpStatusItemMenu 自动定位图标正下方，无坐标换算问题）
- (void)showContextMenu {
  if (!gStatusItem) return;
  NSMenu *menu = [[NSMenu alloc] init];
  NSMenuItem *open =
      [[NSMenuItem alloc] initWithTitle:@"打开主窗口" action:@selector(menuAction:) keyEquivalent:@""];
  open.target = self;
  open.representedObject = @"show-main";
  [menu addItem:open];
  NSMenuItem *settings =
      [[NSMenuItem alloc] initWithTitle:@"偏好设置…" action:@selector(menuAction:) keyEquivalent:@""];
  settings.target = self;
  settings.representedObject = @"settings";
  [menu addItem:settings];
  [menu addItem:[NSMenuItem separatorItem]];
  NSMenuItem *quit =
      [[NSMenuItem alloc] initWithTitle:@"退出 Reopen" action:@selector(menuAction:) keyEquivalent:@""];
  quit.target = self;
  quit.representedObject = @"quit";
  [menu addItem:quit];
  [gStatusItem popUpStatusItemMenu:menu];
}

- (void)menuAction:(id)sender {
  NSString *action = [(NSMenuItem *)sender representedObject];
  EmitEvent("menu", action.UTF8String);
}
@end
static StatusItemTarget *gTarget = nil;

// createStatusItem(callback)：创建托盘按钮+点击事件
Napi::Value CreateStatusItem(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "createStatusItem: expected callback").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  gTsFn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "reopen-tray-events", 0, 1);
  // 长度固定 22pt（BuZhiYin iconMinWidth 同款）：所有 GIF 占位一致；自适应长度算不出
  //  addSubview 的 hostingView 宽度，会偏窄导致图标右边被相邻内容遮挡（裁剪根因）
  gStatusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:22];
  gStatusItem.button.title = @"";
  gTarget = [[StatusItemTarget alloc] init];
  gStatusItem.button.target = gTarget;
  gStatusItem.button.action = @selector(clicked:);
  [gStatusItem.button sendActionOn:(NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown)];
  // 全程纯菜单栏应用身份（LSUIElement 同款，BuZhiYin/RunCat 都是此身份）：
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
  pTrModelSetFrames = reinterpret_cast<void (*)(void *, NSArray *, double, bool)>(dlsym(handle, "tr_model_set_frames"));
  pTrModelSetInterval = reinterpret_cast<void (*)(void *, double)>(dlsym(handle, "tr_model_set_interval"));
  pTrModelSetInvert = reinterpret_cast<void (*)(void *, bool, bool)>(dlsym(handle, "tr_model_set_invert"));
  pTrViewCreate = reinterpret_cast<void *(*)(void *)>(dlsym(handle, "tr_view_create"));
  pTrDestroy = reinterpret_cast<void (*)(void *)>(dlsym(handle, "tr_destroy"));
  if (!pTrModelCreate || !pTrModelSetFrames || !pTrModelSetInterval || !pTrModelSetInvert ||
      !pTrViewCreate || !pTrDestroy) {
    NSLog(@"[reopen-native] dlsym failed: %s", dlerror());
    return env.Undefined();
  }
  gRunnerModel = pTrModelCreate();
  void *viewPtr = pTrViewCreate(gRunnerModel);
  gHostingView = (__bridge NSView *)viewPtr;
  [gStatusItem.button addSubview:gHostingView];  // BuZhiYin 🐔App.swift:70 同款
  return env.Undefined();
}

// setFrames(pngBuffers: Buffer[], isTemplate: boolean, intervalMs: number, box: boolean)：
//   帧序列（JS 已解码/缩放到 2x 像素）→ NSImage 数组（尺寸减半为 pt）→
//   Swift 侧换帧模型。换帧由 Swift .common Timer 驱动（BuZhiYin 同款）。
//   box=方框拉伸显示（只因/篮球等 BuZhiYin .resizable() 同款；否则保持原比例居中）。
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
  pTrModelSetFrames(gRunnerModel, images, intervalMs, box);
  gStatusItem.length = 22;  // 固定 22pt（BuZhiYin 同款，见 CreateStatusItem 注释）
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

// setInvert(light: boolean, dark: boolean)：反转配置（亮色反转/暗色反转，BuZhiYin 同款）——
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
// 当前桌面，不再闪回创建时的旧桌面（LookAway 同款交互）。
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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createStatusItem", Napi::Function::New(env, CreateStatusItem));
  exports.Set("initTrayRunner", Napi::Function::New(env, InitTrayRunner));
  exports.Set("setFrames", Napi::Function::New(env, SetFrames));
  exports.Set("setInterval", Napi::Function::New(env, SetInterval));
  exports.Set("setInvert", Napi::Function::New(env, SetInvert));
  exports.Set("getFrame", Napi::Function::New(env, GetFrame));
  exports.Set("setPanelBehavior", Napi::Function::New(env, SetPanelBehavior));
  exports.Set("startGlobalClickMonitor", Napi::Function::New(env, StartGlobalClickMonitor));
  exports.Set("stopGlobalClickMonitor", Napi::Function::New(env, StopGlobalClickMonitor));
  exports.Set("destroyStatusItem", Napi::Function::New(env, DestroyStatusItem));
  return exports;
}

NODE_API_MODULE(reopen_native, Init)
