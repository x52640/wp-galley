// 產生 Galley.app 的圖示原檔 scripts/app/icon.png（1024×1024）。
// 平常不用跑：icon.png 已經在 repo 裡。想換圖示，直接用自己的 1024×1024 PNG 蓋掉 icon.png、
// 再跑一次 scripts/make-app.sh 即可；要改這個預設圖再跑：
//   swift scripts/app/make-icon.swift scripts/app/icon.png
import AppKit

let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"
let size = 1024
guard let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
  bytesPerRow: 0, bitsPerPixel: 0)
else { fatalError("無法建立畫布") }

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// macOS 圖示格線：824×824 的圓角方塊置中，四周留透明邊。
let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
let path = NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185)
NSGradient(
  starting: NSColor(srgbRed: 0.20, green: 0.21, blue: 0.24, alpha: 1),
  ending: NSColor(srgbRed: 0.09, green: 0.10, blue: 0.12, alpha: 1))!
  .draw(in: path, angle: -90)

// 字母 G：襯線字，米白色（校樣紙的顏色）。
let font = NSFont(name: "Georgia-Bold", size: 600) ?? NSFont.boldSystemFont(ofSize: 600)
let attrs: [NSAttributedString.Key: Any] = [
  .font: font,
  .foregroundColor: NSColor(srgbRed: 0.96, green: 0.93, blue: 0.87, alpha: 1),
]
let letter = NSAttributedString(string: "G", attributes: attrs)
let bounds = letter.boundingRect(with: NSSize(width: 2000, height: 2000), options: [.usesDeviceMetrics])
letter.draw(at: NSPoint(
  x: tile.midX - bounds.width / 2 - bounds.minX,
  y: tile.midY - bounds.height / 2 - bounds.minY - 90))

// 底部一條細線，像校樣上的欄線。
NSColor(srgbRed: 0.84, green: 0.36, blue: 0.24, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 362, y: 262, width: 300, height: 22), xRadius: 11, yRadius: 11).fill()

NSGraphicsContext.restoreGraphicsState()
guard let png = rep.representation(using: .png, properties: [:]) else { fatalError("無法輸出 PNG") }
try png.write(to: URL(fileURLWithPath: output))
print("已寫入 \(output)")
