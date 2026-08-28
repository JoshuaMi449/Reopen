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

    func setFrames(_ images: [NSImage], intervalMs: Double) {
        frames = images
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

/// 图标视图：模板 NSImage 由系统按每屏菜单栏外观着色（深浅屏各自正确）
struct RunnerView: View {
    @ObservedObject var model: RunnerModel
    var body: some View {
        Image(nsImage: model.frames[model.index])
            .resizable()
            .frame(width: model.frames[model.index].size.width,
                   height: model.frames[model.index].size.height)
    }
}

// MARK: - C 接口（addon.mm 通过 dlopen/dlsym 调用）

@_cdecl("tr_model_create")
public func tr_model_create() -> UnsafeMutableRawPointer {
    let m = RunnerModel()
    return Unmanaged.passRetained(m).toOpaque()
}

/// images: NSArray<NSImage>（addon 端已按 pt 尺寸+模板标记准备好）
@_cdecl("tr_model_set_frames")
public func tr_model_set_frames(_ modelPtr: UnsafeMutableRawPointer,
                                _ images: NSArray,
                                _ intervalMs: Double) {
    let m = Unmanaged<RunnerModel>.fromOpaque(modelPtr).takeUnretainedValue()
    m.setFrames(images as! [NSImage], intervalMs: intervalMs)
}

@_cdecl("tr_model_set_interval")
public func tr_model_set_interval(_ modelPtr: UnsafeMutableRawPointer, _ intervalMs: Double) {
    let m = Unmanaged<RunnerModel>.fromOpaque(modelPtr).takeUnretainedValue()
    m.setInterval(intervalMs)
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
