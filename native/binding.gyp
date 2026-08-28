{
  "targets": [
    {
      "target_name": "compile_tray_runner",
      "type": "none",
      "actions": [
        {
          "action_name": "compile_tray_runner_swift",
          "inputs": ["src/tray_runner.swift"],
          "outputs": ["build/Release/libtray_runner.dylib"],
          "action": [
            "xcrun", "swiftc", "-emit-library", "-O",
            "src/tray_runner.swift",
            "-o", "build/Release/libtray_runner.dylib"
          ]
        }
      ]
    },
    {
      "target_name": "reopen_native",
      "sources": ["addon.mm"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "11.0",
        "OTHER_CFLAGS": ["-fobjc-arc"]
      },
      "defines": ["NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")", "compile_tray_runner"],
      "libraries": ["-framework Cocoa", "-framework QuartzCore"]
    }
  ]
}
