# Launch images (iOS)

Drop PNGs in this folder named `WIDTHxHEIGHT.png`. The `<link
rel="apple-touch-startup-image">` tags in `index.html` reference these exact
names — 28 files, one per device per orientation.

**iOS ignores any image whose pixel size does not match the device exactly.**
There is no "one big image" option and no scaling. A missing size is not an
error: iOS falls back to the manifest `background_color` (`#0b0e14`), so an
incomplete set degrades quietly. Start with the phones you actually use.

Design notes: the image is shown full-bleed with no safe-area inset, so keep
anything important away from the top ~15% (status bar / notch) and bottom ~5%
(home indicator). Background `#0b0e14` to match the app, or the splash will
flash against it.

The home-screen ICON is separate and already works — iOS 16.4+ takes it from
`manifest.webmanifest` (`icons/icon-192.png`, `icons/icon-512.png`).

| Device | Portrait | Landscape |
|---|---|---|
| iPhone 16 Pro Max / 15 Pro Max / 14 Pro Max | `1290x2796.png` | `2796x1290.png` |
| iPhone 16 Pro / 15 Pro / 15 / 14 Pro | `1179x2556.png` | `2556x1179.png` |
| iPhone 14 Plus / 13 Pro Max / 12 Pro Max | `1284x2778.png` | `2778x1284.png` |
| iPhone 14 / 13 / 13 Pro / 12 / 12 Pro | `1170x2532.png` | `2532x1170.png` |
| iPhone 13 mini / 12 mini / 11 Pro / XS / X | `1125x2436.png` | `2436x1125.png` |
| iPhone 11 Pro Max / XS Max | `1242x2688.png` | `2688x1242.png` |
| iPhone 11 / XR | `828x1792.png` | `1792x828.png` |
| iPhone SE (2nd/3rd) / 8 / 7 / 6s | `750x1334.png` | `1334x750.png` |
| iPhone 8 Plus / 7 Plus / 6s Plus | `1242x2208.png` | `2208x1242.png` |
| iPad Pro 12.9" | `2048x2732.png` | `2732x2048.png` |
| iPad Pro 11" / Air | `1668x2388.png` | `2388x1668.png` |
| iPad 10.2" | `1620x2160.png` | `2160x1620.png` |
| iPad Pro 10.5" / Air 10.5" | `1668x2224.png` | `2224x1668.png` |
| iPad 9.7" / mini | `1536x2048.png` | `2048x1536.png` |
