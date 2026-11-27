import UIKit
import WebKit
import Capacitor
import AuthenticationServices
import Security

/// Opens the dashboard; signs in with a passkey through Apple's sign-in sheet when needed.
///
/// Flow:
///  1. Load the dashboard. With a live session cookie (the WebView keeps it, 30 days, renewed while used) it just opens.
///  2. Signed out, the dashboard redirects to /login. The navigation guard cancels that and opens
///     ASWebAuthenticationSession at /login?app=1&state=<random>: Ryuk's own page, Face ID, in Safari's context
///     (passkeys work there without any app entitlement, so a free Apple ID is enough).
///     While Cloudflare Access is still switched on, its Google sign-in runs in that sheet too; Google allows it there.
///  3. The page finishes at ryuk://auth?code=…&state=…; the sheet hands that URL straight back to us (no other app sees it).
///  4. We check the state, then load /auth/app/redeem?code=… in the WebView: the server swaps the one-time code
///     (60 s, single use) for a session cookie.
///
/// No secret is compiled into the app.
final class RyukViewController: CAPBridgeViewController, ASWebAuthenticationPresentationContextProviding {

    private let dashURL = URL(string: "https://ryuk-dash.iambharatks.workers.dev/")!
    private var authSession: ASWebAuthenticationSession?
    private var pendingState: String?
    private var navGuard: NavigationGuard?

    // MARK: lifecycle

    override func viewDidLoad() {
        super.viewDidLoad() // Capacitor shows the local loader page (www/index.html)

        if let webView = webView {
            let guardDelegate = NavigationGuard(inner: webView.navigationDelegate, dashHost: dashURL.host ?? "") { [weak self] in
                self?.signIn()
            }
            navGuard = guardDelegate          // navigationDelegate is weak
            webView.navigationDelegate = guardDelegate
            // "Try again" on the loader page → window.webkit.messageHandlers.ryukRetry.postMessage(1)
            webView.configuration.userContentController.add(RetryHandler { [weak self] in
                self?.openDashboard()
            }, name: "ryukRetry")
        }
        openDashboard()
    }

    private func openDashboard() {
        showStatus(nil)
        _ = webView?.load(URLRequest(url: dashURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20))
    }

    // MARK: sign-in sheet

    private func signIn() {
        guard authSession == nil else { return }
        let state = Self.randomState()
        pendingState = state

        var c = URLComponents(url: dashURL.appendingPathComponent("login"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "app", value: "1"), URLQueryItem(name: "state", value: state)]

        let session = ASWebAuthenticationSession(url: c.url!, callbackURLScheme: "ryuk") { [weak self] callback, error in
            DispatchQueue.main.async { self?.finishSignIn(callback: callback, error: error) }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = true   // Face ID every time; nothing lingers in Safari
        authSession = session
        showStatus("Unlock with Face ID to open the notebook.", button: "Sign in")
        if !session.start() {
            authSession = nil
            showStatus("Couldn't open the sign-in sheet.", button: "Try again")
        }
    }

    private func finishSignIn(callback: URL?, error: Error?) {
        authSession = nil
        if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
            showStatus("Sign-in cancelled.", button: "Sign in")
            return
        }
        guard let url = callback,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let code = items.first(where: { $0.name == "code" })?.value,
              let state = items.first(where: { $0.name == "state" })?.value,
              let expected = pendingState, state == expected else {
            showStatus("Sign-in didn't finish (\(error?.localizedDescription ?? "no code came back")).", button: "Try again")
            return
        }
        pendingState = nil
        var c = URLComponents(url: dashURL.appendingPathComponent("auth/app/redeem"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "code", value: code)]
        _ = webView?.load(URLRequest(url: c.url!)) // the response sets the session cookie and redirects to the dashboard
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        view.window ?? ASPresentationAnchor()
    }

    private static func randomState() -> String {
        var bytes = [UInt8](repeating: 0, count: 24)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    // MARK: loader page status

    /// Shows a message (and a button) on the local loader page; does nothing once the dashboard is showing.
    private func showStatus(_ message: String?, button: String? = nil) {
        guard let webView = webView, webView.url?.host != dashURL.host else { return }
        func quoted(_ s: String?) -> String {
            guard let s = s, let data = try? JSONSerialization.data(withJSONObject: [s]), let j = String(data: data, encoding: .utf8) else { return "null" }
            return String(j.dropFirst().dropLast()) // a safely quoted JS string
        }
        webView.evaluateJavaScript("window.ryukStatus && window.ryukStatus(\(quoted(message)), \(quoted(button)))", completionHandler: nil)
    }
}

/// Weak-capturing script message handler (WKUserContentController retains its handlers).
private final class RetryHandler: NSObject, WKScriptMessageHandler {
    private let action: () -> Void
    init(_ action: @escaping () -> Void) { self.action = action }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) { action() }
}

/// Wraps Capacitor's navigation delegate. A main-frame navigation to the dashboard's /login (signed out) or to
/// Cloudflare Access (while it is still on) is cancelled and becomes the sign-in sheet instead, so a login page
/// never loads inside the app's WebView. Everything else is forwarded untouched.
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
        let host = url?.host?.lowercased() ?? ""
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        let toLogin = host == dashHost && url?.path == "/login"
        let toAccess = host == "cloudflareaccess.com" || host.hasSuffix(".cloudflareaccess.com")
        if mainFrame && (toLogin || toAccess) {
            decisionHandler(.cancel)
            DispatchQueue.main.async(execute: onSignIn)
            return
        }
        let forwarded: Void? = inner?.webView?(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)
        if forwarded == nil { decisionHandler(.allow) }
    }
}
