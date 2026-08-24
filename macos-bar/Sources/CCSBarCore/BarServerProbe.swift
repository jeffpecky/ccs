import Foundation
import CryptoKit

// MARK: - BarLaunchDescriptor (written by ccs bar install / ccs bar, decoded by the Swift app)

/// Schema-versioned descriptor that tells the Swift app how to start the server
/// without a shell PATH. Stored at `~/.ccs/bar/launch.json`.
public struct BarLaunchDescriptor: Codable, Sendable {
  /// Schema version — always 1 for the current format.
  public let schema: Int
  /// Absolute path to the node/bun/runtime binary (`process.execPath`).
  public let runtime: String
  /// Arguments to pass to `runtime`, optionally ending in `--port <1...65535>`.
  public let args: [String]
  /// Working directory for the spawned server (`os.homedir()`).
  public let home: String
  /// Value of `CCS_HOME` env var, if it was set when the descriptor was written.
  public let ccsHome: String?

  public init(schema: Int = 1, runtime: String, args: [String], home: String, ccsHome: String?) {
    self.schema = schema
    self.runtime = runtime
    self.args = args
    self.home = home
    self.ccsHome = ccsHome
  }

  public var hasSafeServerArguments: Bool {
    guard args.count == 3 || args.count == 5 else { return false }
    guard args[1] == "bar", args[2] == "serve" else { return false }
    if args.count == 3 { return true }
    guard args[3] == "--port", let port = Int(args[4]) else { return false }
    return (1...65535).contains(port)
  }

  /// Default path for the launch descriptor under `~/.ccs/bar/launch.json`.
  public static func defaultPath(home: String = NSHomeDirectory()) -> String {
    URL(fileURLWithPath: home)
      .appendingPathComponent(".ccs")
      .appendingPathComponent("bar")
      .appendingPathComponent("launch.json")
      .path
  }
}

// MARK: - BarServerProbe

/// Async port-probe that mirrors the TS `defaultFindRunningServer` order:
///   1. bar.json port (if available)
///   2. 3000, 3001, 3002, 8000, 8080
///   Each port is tried on 127.0.0.1 then ::1.
///   Liveness check: GET /api/bar/summary -> 200 with authenticated nonce proof.
///
/// The transport is injectable so the check harness can test ordering without
/// a live server.
public struct BarServerProbe: Sendable {
  /// Fallback probe ports in order (after bar.json port).
  static let fallbackPorts = [3000, 3001, 3002, 8000, 8080]

  private let transport: HTTPTransport
  private let authToken: String?

  public init(transport: HTTPTransport = URLSessionTransport()) {
    self.transport = transport
    self.authToken = Self.loadAuthToken()
  }

  public init(transport: HTTPTransport, authToken: String?) {
    self.transport = transport
    self.authToken = authToken
  }

  /// Probe for a live CCS server. Returns the base URL of the first responding
  /// server, or `nil` if none respond within the attempt.
  ///
  /// - Parameter discovery: The current bar.json contents, if available.
  ///   Its port is probed first before the fallback list.
  public func findLiveServer(discovery: BarDiscovery?) async -> URL? {
    let candidatePorts = buildCandidatePorts(discovery: discovery)

    for port in candidatePorts {
      if let url = await probePort(port) {
        return url
      }
    }
    return nil
  }

  // MARK: - Private

  /// Build the ordered port list: bar.json port first (deduplicated), then fallbacks.
  private func buildCandidatePorts(discovery: BarDiscovery?) -> [Int] {
    var ports: [Int] = []
    if let d = discovery {
      ports.append(d.port)
    }
    for p in Self.fallbackPorts where !ports.contains(p) {
      ports.append(p)
    }
    return ports
  }

  /// Try 127.0.0.1 then ::1 for the given port.
  /// Returns the first base URL that responds 200 to /api/bar/summary, or nil.
  private func probePort(_ port: Int) async -> URL? {
    let hosts = ["127.0.0.1", "::1"]
    for host in hosts {
      // IPv6 addresses must be bracketed in URLs.
      let hostStr = host.contains(":") ? "[\(host)]" : host
      guard let base = URL(string: "http://\(hostStr):\(port)") else { continue }
      if await isLive(baseURL: base) {
        return base
      }
    }
    return nil
  }

  static func loadAuthToken(home: String = NSHomeDirectory()) -> String? {
    let ccsDir = ProcessInfo.processInfo.environment["CCS_HOME"] ??
      URL(fileURLWithPath: home).appendingPathComponent(".ccs").path
    let tokenPath = URL(fileURLWithPath: ccsDir).appendingPathComponent("bar/.auth-token")
    guard
      let token = try? String(contentsOf: tokenPath, encoding: .utf8)
        .trimmingCharacters(in: .whitespacesAndNewlines),
      token.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil
    else { return nil }
    return token
  }

  private static func hexData(_ value: String) -> Data? {
    guard value.count == 64,
      value.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil
    else { return nil }
    var data = Data()
    var index = value.startIndex
    while index < value.endIndex {
      let next = value.index(index, offsetBy: 2)
      guard let byte = UInt8(value[index..<next], radix: 16) else { return nil }
      data.append(byte)
      index = next
    }
    return data
  }

  /// Returns true only when HTTP 200 includes HMAC-SHA256(token, nonce).
  private func isLive(baseURL: URL) async -> Bool {
    guard let authToken else { return false }
    let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    let url = baseURL.appendingPathComponent("api/bar/summary")
    var req = URLRequest(url: url)
    req.timeoutInterval = 2.0
    req.setValue(nonce, forHTTPHeaderField: "x-ccs-bar-nonce")
    let requestProof = HMAC<SHA256>.authenticationCode(
      for: Data(nonce.utf8),
      using: SymmetricKey(data: Data(authToken.utf8)))
      .map { String(format: "%02x", $0) }.joined()
    req.setValue(requestProof, forHTTPHeaderField: "x-ccs-bar-token")
    do {
      let (_, http) = try await transport.send(req)
      guard http.statusCode == 200,
        let proof = http.value(forHTTPHeaderField: "x-ccs-bar-token"),
        let proofData = Self.hexData(proof)
      else { return false }
      return HMAC<SHA256>.isValidAuthenticationCode(
        proofData,
        authenticating: Data(nonce.utf8),
        using: SymmetricKey(data: Data(authToken.utf8)))
    } catch {
      return false
    }
  }
}
