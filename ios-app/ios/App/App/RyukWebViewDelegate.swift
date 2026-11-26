import UIKit
import WebKit
import Capacitor

/// Loads the Access-protected dashboard inside the WebView using a Cloudflare Access service token.
///
/// Flow:
///  1. Capacitor boots on the local loader page (www/index.html). There is no server.url, so nothing races us.
///  2. A native request with the CF-Access-Client-Id/Secret headers gets Access's CF_Authorization cookie.
///  3. The cookie goes into the WebView's cookie store, then the dashboard loads (headers on that request too).
///     Every later same-origin request (/api/..., /api/file/...) carries the cookie.
///  4. Any navigation to *.cloudflareaccess.com (cookie expired) is cancelled and we re-authenticate,
///     so the login flow can never reach Safari.
///
/// Credentials come from Info.plist ← ios/secrets.xcconfig (gitignored). Nothing secret lives in this file.
final class RyukViewController: CAPBridgeViewController {

    private let dashURL = URL(string: "https://ryuk-dash.iambharatks.workers.dev/")!
    private let refreshAfter: TimeInterval = 15 * 60
    private var lastAuth: Date?
    private var lastAccessRedirect: Date?
    private var authInFlight = false
    private var navGuard: NavigationGuard?

    // MARK: lifecycle

    override func viewDidLoad() {
        super.viewDidLoad() // Capacitor loads the local loader page

        if let webView = webView {
            let guardDelegate = NavigationGuard(inner: webView.navigationDelegate) { [weak self] in
                self?.accessRedirectIntercepted()
            }
            navGuard = guardDelegate          // navigationDelegate is weak
            webView.navigationDelegate = guardDelegate
            // Retry button on the loader page → window.webkit.messageHandlers.ryukRetry.postMessage(1)
            webView.configuration.userContentController.add(RetryHandler { [weak self] in
                self?.authenticate(load: true)
            }, name: "ryukRetry")
        }

        NotificationCenter.default.addObserver(self, selector: #selector(willEnterForeground),
                                               name: UIScene.willEnterForegroundNotification, object: nil)
        authenticate(load: true)
    }

    @objc private func willEnterForeground() {
        let onDashboard = webView?.url?.host == dashURL.host
        if !onDashboard {
            authenticate(load: true)
        } else if lastAuth.map({ Date().timeIntervalSince($0) > refreshAfter }) ?? true {
            authenticate(load: false) // silently refresh the cookie, keep the page as is
        }
    }

    private func accessRedirectIntercepted() {
        // Guard against a loop if Access keeps rejecting us.
        if let last = lastAccessRedirect, Date().timeIntervalSince(last) < 10 {
            showStatus("Cloudflare Access keeps asking for login. Check the Service Auth policy and the token.")
            return
        }
        lastAccessRedirect = Date()
        authenticate(load: true)
    }

    // MARK: auth

    private func credential(_ key: String) -> String? {
        guard let v = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !v.isEmpty, !v.hasPrefix("$("), !v.hasPrefix("REPLACE") else { return nil }
        return v
    }

    private func authorizedRequest(id: String, secret: String) -> URLRequest {
        var req = URLRequest(url: dashURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        req.setValue(id, forHTTPHeaderField: "CF-Access-Client-Id")
        req.setValue(secret, forHTTPHeaderField: "CF-Access-Client-Secret")
        return req
    }

    private func authenticate(load: Bool) {
        guard !authInFlight else { return }
        guard let id = credential("RyukCFClientId"), let secret = credential("RyukCFClientSecret") else {
            showStatus("No service token in this build. Fill ios/secrets.xcconfig and rebuild.")
            return
        }
        authInFlight = true
        if load { showStatus(nil) }

        let req = authorizedRequest(id: id, secret: secret)
        let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
        session.dataTask(with: req) { [weak self] data, response, error in
            session.finishTasksAndInvalidate()
            DispatchQueue.main.async {
                self?.handleAuth(request: req, data: data, response: response, error: error, load: load)
            }
        }.resume()
    }

    private func handleAuth(request: URLRequest, data: Data?, response: URLResponse?, error: Error?, load: Bool) {
        authInFlight = false

        guard let http = response as? HTTPURLResponse else {
            if load { showStatus("Can't reach the dashboard (\(error?.localizedDescription ?? "no response")). Check your connection.") }
            return
        }
        guard http.statusCode == 200 else {
            if load { showStatus(Self.explain(http, data)) }
            return
        }

        var fields: [String: String] = [:]
        for (k, v) in http.allHeaderFields { if let k = k as? String, let v = v as? String { fields[k] = v } }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: fields, for: dashURL)
        if !cookies.contains(where: { $0.name == "CF_Authorization" }) {
            CAPLog.print("⚠️ Ryuk: Access returned no CF_Authorization cookie; API calls may fail")
        }

        guard let store = webView?.configuration.websiteDataStore.httpCookieStore else { return }
        let group = DispatchGroup()
        for cookie in cookies {
            group.enter()
            store.setCookie(cookie) { group.leave() }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            self.lastAuth = Date()
            if load { _ = self.webView?.load(request) } // cookie is set before this request leaves
        }
    }

    private static func explain(_ http: HTTPURLResponse, _ data: Data?) -> String {
        let code = http.statusCode
        let location = http.value(forHTTPHeaderField: "Location") ?? ""
        if (300..<400).contains(code), location.contains("cloudflareaccess.com") {
            return "Access ignored the service token (redirected to login). Is the Service Auth policy attached to the ryuk-dash application?"
        }
        // The worker's own 403 is plain text "Forbidden (<reason>)" and reveals no values.
        if code == 403, let data = data, data.count < 200,
           let body = String(data: data, encoding: .utf8), body.hasPrefix("Forbidden (") {
            return "The dashboard rejected the token: \(body). Set ALLOWED_SERVICE_TOKEN on ryuk-dash."
        }
        if code == 403 {
            return "Cloudflare Access refused the token (HTTP 403). Check the token is current and the Service Auth policy includes it."
        }
        return "Unexpected response from the dashboard (HTTP \(code))."
    }

    // MARK: loader page status

    private func showStatus(_ message: String?) {
        guard let webView = webView, webView.url?.host != dashURL.host else { return }
        let arg: String
        if let message = message,
           let json = try? JSONSerialization.data(withJSONObject: [message]),
           let s = String(data: json, encoding: .utf8) {
            arg = String(s.dropFirst().dropLast()) // safely quoted JS string
        } else {
            arg = "null"
        }
        webView.evaluateJavaScript("window.ryukStatus && window.ryukStatus(\(arg))", completionHandler: nil)
    }
}

/// Weak-capturing script message handler (WKUserContentController retains its handlers).
private final class RetryHandler: NSObject, WKScriptMessageHandler {
    private let action: () -> Void
    init(_ action: @escaping () -> Void) { self.action = action }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) { action() }
}

/// Don't follow redirects in the native auth request: a redirect means Access wants a login.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Wraps Capacitor's navigation delegate. Navigations to Cloudflare Access are cancelled (and trigger
/// re-auth) instead of letting Capacitor hand them to Safari. Everything else is forwarded untouched.
private final class NavigationGuard: NSObject, WKNavigationDelegate {
    private weak var inner: WKNavigationDelegate?
    private let onAccessRedirect: () -> Void

    init(inner: WKNavigationDelegate?, onAccessRedirect: @escaping () -> Void) {
        self.inner = inner
        self.onAccessRedirect = onAccessRedirect
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (inner?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        (inner?.responds(to: aSelector) ?? false) ? inner : nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let host = navigationAction.request.url?.host?.lowercased(),
           host == "cloudflareaccess.com" || host.hasSuffix(".cloudflareaccess.com") {
            decisionHandler(.cancel)
            DispatchQueue.main.async(execute: onAccessRedirect)
            return
        }
        let forwarded: Void? = inner?.webView?(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)
        if forwarded == nil { decisionHandler(.allow) }
    }
}
