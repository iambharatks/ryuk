import UIKit
import WebKit
import Capacitor
import LocalAuthentication
import Security

/// Opens the dashboard after Face ID. No browser, no redirect, no Google.
///
/// The app owns a P-256 key made inside the iPhone's Secure Enclave: it can't be copied out, and every use needs
/// Face ID (the current enrolment: adding a new face makes the key unusable, so the app must be paired again).
///
/// Pairing (once): on the signed-in website, Keys → "Pair the iPhone app" shows a 6-digit code (5 min, one use).
///   The app makes its key, signs  "ryuk-pair\n<code>\n<public key>"  (Face ID) and sends code + public key + signature
///   to POST /auth/device/pair. The server keeps the public key and returns a device id.
/// Every launch:
///   POST /auth/device/challenge → random challenge; sign "ryuk-device-login\n<challenge>\n<device id>" (Face ID);
///   POST /auth/device/login → Set-Cookie (the dashboard session). The cookie goes into the WebView, which loads the dashboard.
/// If the dashboard ever navigates to /login (session ended), the guard cancels it and signs in again the same way.
///
/// Nothing secret is compiled into the app; the device id is not a secret.
final class RyukViewController: CAPBridgeViewController {

    private let dashURL = URL(string: "https://ryuk-dash.iambharatks.workers.dev/")!
    private let loaderURL = URL(string: "capacitor://localhost/")!     // Capacitor serves www/index.html here
    private var navGuard: NavigationGuard?
    private var busy = false
    private var pendingPairing: String??     // a pairing prompt to show once the loader page is ready (.some(nil) = no message)

    // MARK: lifecycle

    override func viewDidLoad() {
        super.viewDidLoad() // Capacitor shows the local loader page (www/index.html)

        if let webView = webView {
            let guardDelegate = NavigationGuard(inner: webView.navigationDelegate, dashHost: dashURL.host ?? "") { [weak self] in
                self?.signIn()
            }
            navGuard = guardDelegate          // navigationDelegate is weak
            webView.navigationDelegate = guardDelegate
            let ucc = webView.configuration.userContentController
            // the loader page says when it is ready: then start (or show the pairing prompt we were waiting to show)
            ucc.add(MessageHandler { [weak self] _ in self?.loaderReady() }, name: "ryukReady")
            ucc.add(MessageHandler { [weak self] _ in self?.start() }, name: "ryukRetry")
            ucc.add(MessageHandler { [weak self] body in
                if let code = body as? String { self?.pair(code: code) }
            }, name: "ryukPair")
        }
    }

    private func loaderReady() {
        if let pending = pendingPairing {
            pendingPairing = nil
            showPairing(pending)
        } else {
            start()
        }
    }

    /// Paired → Face ID sign-in. Not paired → ask for the code.
    private func start() {
        if DeviceKey.deviceId != nil && DeviceKey.exists() {
            signIn()
        } else {
            showPairing(nil)
        }
    }

    // MARK: pairing

    private func pair(code: String) {
        guard !busy else { return }
        let digits = code.filter(\.isNumber)
        guard digits.count == 6 else { showPairing("Enter the 6 digits shown on the website."); return }
        busy = true
        showStatus("Pairing…", button: nil)
        Task { @MainActor in
            var paired = false
            do {
                DeviceKey.reset()
                let made = try DeviceKey.create()
                let key = DeviceKey.load(reason: "Pair this iPhone with Ryuk") ?? made
                let pub = try DeviceKey.publicKey(key)
                let sig = try DeviceKey.sign(key, "ryuk-pair\n\(digits)\n\(pub)")
                let (status, json, _) = try await post("auth/device/pair",
                    ["code": digits, "public_key": pub, "signature": sig, "name": UIDevice.current.name])
                if status == 200, let id = json["device_id"] as? String {
                    DeviceKey.deviceId = id
                    paired = true
                } else {
                    DeviceKey.reset()
                    showPairing((json["error"] as? String).map { "Not paired: \($0)." } ?? "Not paired (HTTP \(status)).")
                }
            } catch let e as DeviceKey.Failure where e == .cancelled {
                DeviceKey.reset()
                showPairing("Face ID was cancelled.")
            } catch {
                DeviceKey.reset()
                showPairing(Self.describe(error))
            }
            busy = false
            if paired { signIn() }
        }
    }

    // MARK: sign in

    private func signIn() {
        guard !busy else { return }
        guard let deviceId = DeviceKey.deviceId, let key = DeviceKey.load(reason: "Open your notebook") else {
            showPairing(nil); return
        }
        busy = true
        showStatus("Unlocking…", button: nil)
        Task { @MainActor in
            defer { busy = false }
            do {
                let (s1, c, _) = try await post("auth/device/challenge", [:])
                guard s1 == 200, let challenge = c["challenge"] as? String else { throw DeviceKey.Failure.server(s1, c["error"] as? String) }
                let sig = try DeviceKey.sign(key, "ryuk-device-login\n\(challenge)\n\(deviceId)")
                let (s2, j, http) = try await post("auth/device/login", ["device_id": deviceId, "challenge": challenge, "signature": sig])
                if s2 == 401, (j["code"] as? String) == "unpaired" {
                    DeviceKey.reset()
                    showPairing("This iPhone was unpaired on the website. Pair it again.")
                    return
                }
                guard s2 == 200 else { throw DeviceKey.Failure.server(s2, j["error"] as? String) }
                try await setCookies(from: http)
                _ = webView?.load(URLRequest(url: dashURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20))
            } catch let e as DeviceKey.Failure where e == .cancelled {
                showStatus("Face ID was cancelled.", button: "Unlock")
            } catch let e as DeviceKey.Failure where e == .keyGone {
                DeviceKey.reset()
                showPairing("Face ID changed on this iPhone, so its key was retired. Pair it again.")
            } catch {
                showStatus(Self.describe(error), button: "Try again")
            }
        }
    }

    // MARK: network

    /// POST JSON to the dashboard from native code (no Origin header, no cookies of its own).
    private func post(_ path: String, _ body: [String: Any]) async throws -> (Int, [String: Any], HTTPURLResponse) {
        var req = URLRequest(url: dashURL.appendingPathComponent(path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        req.httpShouldHandleCookies = false
        let session = URLSession(configuration: .ephemeral)
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw DeviceKey.Failure.network }
        if let host = http.url?.host, host != dashURL.host { throw DeviceKey.Failure.accessStillOn }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        return (http.statusCode, json, http)
    }

    /// Copy the session cookie from the sign-in response into the WebView's cookie store.
    private func setCookies(from http: HTTPURLResponse) async throws {
        var fields: [String: String] = [:]
        for (k, v) in http.allHeaderFields { if let k = k as? String, let v = v as? String { fields[k] = v } }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: fields, for: dashURL)
        guard !cookies.isEmpty, let store = webView?.configuration.websiteDataStore.httpCookieStore else { throw DeviceKey.Failure.network }
        for cookie in cookies { await store.setCookie(cookie) }
    }

    private static func describe(_ error: Error) -> String {
        switch error as? DeviceKey.Failure {
        case .accessStillOn?: return "Cloudflare Access is still switched on for the dashboard. Turn it off, then try again."
        case .server(let code, let msg)?: return "The dashboard said: \(msg ?? "HTTP \(code)")."
        case .noSecureEnclave?: return "This device has no Secure Enclave (a simulator?). Run Ryuk on your iPhone."
        default:
            if (error as NSError).domain == NSURLErrorDomain { return "Can't reach the dashboard. Check your connection." }
            return "Something went wrong: \(error.localizedDescription)"
        }
    }

    // MARK: loader page

    private func onLoader() -> Bool { webView?.url?.host != dashURL.host }

    private func showStatus(_ message: String?, button: String?) {
        guard let webView = webView, onLoader() else { return }
        webView.evaluateJavaScript("window.ryukStatus && window.ryukStatus(\(Self.js(message)), \(Self.js(button)))", completionHandler: nil)
    }

    /// Show the pairing prompt. If the dashboard is showing, go back to the app's own loader page first;
    /// it reports ready (ryukReady), then the prompt appears.
    private func showPairing(_ message: String?) {
        guard let webView = webView else { return }
        if !onLoader() {
            pendingPairing = .some(message)
            _ = webView.load(URLRequest(url: loaderURL))
            return
        }
        webView.evaluateJavaScript("window.ryukPairing && window.ryukPairing(\(Self.js(message)))", completionHandler: nil)
    }

    private static func js(_ s: String?) -> String {
        guard let s = s, let data = try? JSONSerialization.data(withJSONObject: [s]), let j = String(data: data, encoding: .utf8) else { return "null" }
        return String(j.dropFirst().dropLast()) // a safely quoted JS string
    }
}

// MARK: - the Secure Enclave key

enum DeviceKey {
    enum Failure: Error, Equatable { case cancelled, keyGone, noSecureEnclave, network, accessStillOn, server(Int, String?) }

    private static let tag = Data("com.iambharatks.ryuk.devicekey".utf8)
    private static let idKey = "ryuk.deviceId"

    /// The id the server gave this iPhone when it paired (not a secret).
    static var deviceId: String? {
        get { UserDefaults.standard.string(forKey: idKey) }
        set { UserDefaults.standard.set(newValue, forKey: idKey) }
    }

    static func exists() -> Bool {
        let ctx = LAContext()
        ctx.interactionNotAllowed = true    // just look; never prompt
        let q: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag,
                                kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecUseAuthenticationContext as String: ctx]
        let status = SecItemCopyMatching(q as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    static func create() throws -> SecKey {
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                                                           [.privateKeyUsage, .biometryCurrentSet], nil) else { throw Failure.noSecureEnclave }
        let attrs: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tag,
                kSecAttrAccessControl as String: access,
            ] as [String: Any],
        ]
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attrs as CFDictionary, &error) else { throw Failure.noSecureEnclave }
        return key
    }

    /// A handle to the private key; Face ID is asked (with this reason) when it signs.
    static func load(reason: String) -> SecKey? {
        let ctx = LAContext()
        ctx.localizedReason = reason
        let q: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag,
                                kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecReturnRef as String: true,
                                kSecUseAuthenticationContext as String: ctx]
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let found = item else { return nil }
        return (found as! SecKey)
    }

    /// X9.63 uncompressed public key (65 bytes), base64url.
    static func publicKey(_ priv: SecKey) throws -> String {
        guard let pub = SecKeyCopyPublicKey(priv), let raw = SecKeyCopyExternalRepresentation(pub, nil) as Data? else { throw Failure.noSecureEnclave }
        return b64url(raw)
    }

    /// ECDSA P-256 / SHA-256 over the UTF-8 message, DER-encoded, base64url. Shows Face ID.
    static func sign(_ key: SecKey, _ message: String) throws -> String {
        var error: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, Data(message.utf8) as CFData, &error) as Data? else {
            let e = error?.takeRetainedValue()
            let code = e.map { CFErrorGetCode($0) } ?? 0
            if code == Int(errSecUserCanceled) || code == LAError.userCancel.rawValue || code == LAError.appCancel.rawValue || code == LAError.systemCancel.rawValue {
                throw Failure.cancelled
            }
            if code == Int(errSecItemNotFound) || code == Int(errSecAuthFailed) || code == LAError.biometryNotEnrolled.rawValue { throw Failure.keyGone }
            throw e.map { $0 as Error } ?? Failure.noSecureEnclave
        }
        return b64url(sig)
    }

    /// Forget the key and the device id (unpaired, or pairing again).
    static func reset() {
        let q: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag]
        SecItemDelete(q as CFDictionary)
        deviceId = nil
    }

    private static func b64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

// MARK: - plumbing

/// Weak-capturing script message handler (WKUserContentController retains its handlers).
private final class MessageHandler: NSObject, WKScriptMessageHandler {
    private let action: (Any) -> Void
    init(_ action: @escaping (Any) -> Void) { self.action = action }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) { action(message.body) }
}

/// Wraps Capacitor's navigation delegate. A main-frame navigation to the dashboard's /login (the session ended)
/// is cancelled and becomes a Face ID sign-in instead, so a login page never loads inside the app.
/// Everything else is forwarded untouched.
private final class NavigationGuard: NSObject, WKNavigationDelegate {
    private weak var inner: WKNavigationDelegate?
    private let dashHost: String
    private let onSignIn: () -> Void

    init(inner: WKNavigationDelegate?, dashHost: String, onSignIn: @escaping () -> Void) {
        self.inner = inner
        self.dashHost = dashHost.lowercased()
        self.onSignIn = onSignIn
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (inner?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        (inner?.responds(to: aSelector) ?? false) ? inner : nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if mainFrame, url?.host?.lowercased() == dashHost, url?.path == "/login" {
            decisionHandler(.cancel)
            DispatchQueue.main.async(execute: onSignIn)
            return
        }
        let forwarded: Void? = inner?.webView?(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)
        if forwarded == nil { decisionHandler(.allow) }
    }
}
