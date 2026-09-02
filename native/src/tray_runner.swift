// 托盘图标 SwiftUI 渲染模块（BuZhiYin 🐔View.swift 同款结构，2026-08-28 实验定稿）：
//   三图标对比实验实锤：NSHostingView+SwiftUI Timer 换帧是「非活跃屏冻结最后一帧」的
//   唯一可行管线（NSImageView 换图 / layer.contents 换帧在非活跃屏都会跟着动）。
//   本模块编译为 dylib（binding.gyp action 调用 swiftc），addon.mm dlopen 调用，
//   只负责：NSHostingView 视图 + .common RunLoop Timer 换帧（帧序列与间隔由 JS 传入）。
import AppKit
import SwiftUI

/// 换帧模型（@Published 驱动 SwiftUI 视图更新，BuZhiYin imageIndex 同款）
final class RunnerModel: ObservableObject {
    @Published var index: Int = 0
    var frames: [NSImage] = []
    var timer: Timer?
    /// 反转配置（照 BuZhiYin ZhiyinEntity light_invert/dark_invert）：
    ///   lightInvert=浅色菜单栏反转颜色；darkInvert=深色菜单栏反转颜色
    var lightInvert = false
    var darkInvert = false
    /// 方框拉伸显示（BuZhiYin 同款：.resizable() 拉伸填满 22×22）；false=保持原比例居中
    var box = false
    /// 水平翻转（RunCat Runner Flip 同款：显示层镜像帧，素材文件不动）
    @Published var flipped = false
    /// 菜单栏窗口外观深浅（RunCat window.effectiveAppearance 同款判定）：
    ///   双屏一浅一暗时 colorScheme 是全局值会判错，此值由 native 侧 KVO 每屏推来；
    ///   nil=未知（回退 colorScheme）
    @Published var menuBarDark: Bool? = nil

    func setFrames(_ images: [NSImage], intervalMs: Double, box: Bool) {
        frames = images
        self.box = box
        index = 0
        start(intervalMs: intervalMs)
    }

    func setInterval(_ ms: Double) {
        if timer != nil {
            start(intervalMs: ms)
        }
    }

    private func start(intervalMs: Double) {
        timer?.invalidate()
        // BuZhiYin 🐔View.swift:48 同款：.main + .common（菜单打开等场景也持续换帧）
        let t = Timer(timeInterval: max(0.04, intervalMs / 1000.0), repeats: true) { [weak self] _ in
            guard let self = self, !self.frames.isEmpty else { return }
            self.index = (self.index + 1) % self.frames.count
        }
        timer = t
        RunLoop.main.add(t, forMode: .common)
    }
}

/// 图标视图（只服务双色 GIF 角色；mono 静态主题图标走 addon 系统模板图渲染，
///   button.image=template NSImage，系统按每屏壁纸着色+非活跃自动灰，不经此视图）：
///   普通图按当前菜单栏外观决定是否反转颜色（BuZhiYin AutoInvertImage 同款）。
///   原图直传（2026-08-28 定稿）：活跃时显示 GIF 原样（白球+黑线），非活跃屏由系统
///   自动压暗亮部/提亮暗部（实测只剩线条，与 BuZhiYin 一致）；软件不再叠任何变淡
///   （系统灰×软件灰=双重变暗「很黑」根因，2026-08-31 删除）。
///   占位统一 22×22（BuZhiYin iconMinWidth=22 同款）：box 角色拉伸填满（只因/篮球，
///   与 BuZhiYin .resizable() 分毫不差），其余保持原比例居中（占位一致、内容不变形）。
struct RunnerView: View {
    @ObservedObject var model: RunnerModel
    @Environment(\.colorScheme) var scheme

    @ViewBuilder
    var body: some View {
        // mono 静态主题图标走 addon button.image 系统模板渲染，模型无帧：
        //   hosting view 仍挂在按钮上（外观推送会触发刷新），空帧必须占位防越界
        //   （2026-08-31 崩溃实锤：frames 空时 body 读 frames[index] → SIGTRAP）
        if model.frames.isEmpty {
            Color.clear.frame(width: 22, height: 22)
        } else {
            // 深浅判定用菜单栏窗口 effectiveAppearance（KVO 推来），未知时回退 colorScheme
            let isDark = model.menuBarDark ?? (scheme == .dark)
            let img = Image(nsImage: model.frames[model.index]).resizable()
                .scaleEffect(x: model.flipped ? -1 : 1, y: 1, anchor: .center)
            let invert = (!isDark && model.lightInvert) || (isDark && model.darkInvert)
            if model.box {
                if invert {
                    img.frame(width: 22, height: 22).colorInvert()
                } else {
                    img.frame(width: 22, height: 22)
                }
            } else {
                if invert {
                    img.aspectRatio(contentMode: .fit)
                        .frame(width: 22, height: 22).colorInvert()
                } else {
                    img.aspectRatio(contentMode: .fit).frame(width: 22, height: 22)
                }
            }
        }
    }
}

// MARK: - C 接口（addon.mm 通过 dlopen/dlsym 调用）

@_cdecl("tr_model_create")
public func tr_model_create() -> UnsafeMutableRawPointer {
    let m = RunnerModel()
    return Unmanaged.passRetained(m).toOpaque()
}

/// images: NSArray<NSImage>（addon 端已按 pt 尺寸准备好）；box=方框拉伸显示
@_cdecl("tr_model_set_frames")
public func tr_model_set_frames(_ modelPtr: UnsafeMutableRawPointer,
                                _ images: NSArray,
                                _ intervalMs: Double,
                                _ box: Bool) {
    let m = Unmanaged<RunnerModel>.fromOpaque(modelPtr).takeUnretainedValue()
    m.setFrames(images as! [NSImage], intervalMs: intervalMs, box: box)
}

@_cdecl("tr_model_set_interval")
public func tr_model_set_interval(_ modelPtr: UnsafeMutableRawPointer, _ intervalMs: Double) {
    let m = Unmanaged<RunnerModel>.fromOpaque(modelPtr).takeUnretainedValue()
    m.setInterval(intervalMs)
}

/// 反转配置（浅色菜单栏反转 / 深色菜单栏反转，BuZhiYin 亮色反转/暗色反转同款）
@_cdecl("tr_model_set_invert")
public func tr_model_set_invert(_ modelPtr: UnsafeMutableRawPointer,
                                _ light: Bool, _ dark: Bool) {
    let m = Unmanaged<RunnerModel>.fromOpaque(modelPtr).takeUnretainedValue()
    m.lightInvert = light
    m.darkInvert = dark
}

/// 水平翻转开关（RunCat Runner Flip 同款）
@_cdecl("tr_model_set_flip")
public func tr_model_set_flip(_ modelPtr: UnsafeMutableRawPointer, _ flipped: Bool) {
    let m = Unmanaged<RunnerModel>.fromOpaque(modelPtr).takeUnretainedValue()
    m.flipped = flipped
}

/// 菜单栏明暗（native 侧 KVO 按钮视图 effectiveAppearance 推来，替代全局 colorScheme 判定）
@_cdecl("tr_model_set_dark")
public func tr_model_set_dark(_ modelPtr: UnsafeMutableRawPointer, _ isDark: Bool) {
    let m = Unmanaged<RunnerModel>.fromOpaque(modelPtr).takeUnretainedValue()
    m.menuBarDark = isDark
}

/// 返回 NSHostingView 裸指针（addon 挂到 status button 上，button 持有）
@_cdecl("tr_view_create")
public func tr_view_create(_ modelPtr: UnsafeMutableRawPointer) -> UnsafeMutableRawPointer {
    let m = Unmanaged<RunnerModel>.fromOpaque(modelPtr).takeUnretainedValue()
    let hosting = NSHostingView(rootView: RunnerView(model: m))
    hosting.frame = NSRect(x: 0, y: 0, width: 22, height: 22)
    return Unmanaged.passUnretained(hosting).toOpaque()
}

@_cdecl("tr_destroy")
public func tr_destroy(_ modelPtr: UnsafeMutableRawPointer) {
    let m = Unmanaged<RunnerModel>.fromOpaque(modelPtr).takeRetainedValue()
    m.timer?.invalidate()
}
