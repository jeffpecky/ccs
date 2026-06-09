import SwiftUI

/// A compact bar sparkline for daily values (e.g. cost per day over 7 days).
/// Zero-value days render as faint placeholders so the cadence stays readable.
struct Sparkline: View {
  let values: [Double]
  var accent: Color = BarTheme.accent

  var body: some View {
    GeometryReader { geo in
      let peak = max(values.max() ?? 0, 0.0001)
      HStack(alignment: .bottom, spacing: 3) {
        ForEach(Array(values.enumerated()), id: \.offset) { _, value in
          let height = CGFloat(value / peak) * geo.size.height
          RoundedRectangle(cornerRadius: 2)
            .fill(value > 0 ? accent : Color.secondary.opacity(0.2))
            .frame(height: max(2, height))
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    }
  }
}

/// Shared visual tokens for the menu. The accent matches the CCS logo orange.
enum BarTheme {
  static let accent = Color(red: 0.886, green: 0.451, blue: 0.137) // ~#E2732A
  /// Distinct tint for native first-party subscription rows (Claude Code / Codex)
  /// so the user's own plan reads apart from CLIProxy pool accounts. A cool indigo
  /// contrasts with the warm orange accent used for everything else.
  static let subscription = Color(red: 0.357, green: 0.388, blue: 0.851) // ~#5B63D9
}
