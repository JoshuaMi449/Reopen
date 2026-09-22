import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let sampler = NSColorSampler()
sampler.show { color in
    if let srgb = color?.usingColorSpace(.sRGB) {
        let r = Int((srgb.redComponent * 255).rounded())
        let g = Int((srgb.greenComponent * 255).rounded())
        let b = Int((srgb.blueComponent * 255).rounded())
        print(String(format: "#%02X%02X%02X", r, g, b))
    }
    app.terminate(nil)
}

app.run()
