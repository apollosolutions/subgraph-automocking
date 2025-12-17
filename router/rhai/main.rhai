// Apollo Router Rhai Script: Subgraph Service URL Rewriting for Mocking Proxy
//
// This script rewrites subgraph URLs to route through the mocking proxy server
// when running in development environments. The mocking proxy provides:
// - Passthrough mode: Forwards requests to live subgraphs when available
// - Mocking mode: Returns mock responses when subgraphs are unavailable
//
// URL Rewriting Scheme:
//   Original: http://users-service:4001/graphql
//   Rewritten: http://localhost:3000/http%3A%2F%2Fusers-service%3A4001%2Fgraphql
//
// Configuration:
//   SUBGRAPH_PROXY_ENABLED: "true" | "false" - Enable/disable proxy routing
//   SUBGRAPH_PROXY_HOST: "host:port" - Mocking proxy address (default: localhost:3000)

// Main entry point: Called for each subgraph request
fn subgraph_service(service, subgraph) {
    let proxy_enabled;
    let proxy_host;
    try {
        // Read proxy configuration from environment
        proxy_enabled = env::get("SUBGRAPH_PROXY_ENABLED");
        proxy_host = env::get("SUBGRAPH_PROXY_HOST");
    } catch (err) {
        if proxy_enabled == () {
            log_warn("SUBGRAPH_PROXY_ENABLED not set, defaulting to false");
            proxy_enabled = "false";
        }

        if proxy_host == () {
            log_warn("SUBGRAPH_PROXY_HOST not set, defaulting to localhost:3000");
            proxy_host = "localhost:3000";
        }
    }

    let proxy_url_details = extract_url_details(proxy_host);
    let host = proxy_url_details.host;
    let port = proxy_url_details.port;
    
    
    // Only rewrite URLs if proxy is explicitly enabled
    if proxy_enabled == "true" {
        log_info(`Mocking proxy enabled - routing through http://${host}:${port}`);

        // Map the request to rewrite the URI
        service.map_request(|req| {
            // Get the original subgraph URL
            let original_url = req.subgraph.uri.to_string();

            // URL-encode the original URL for safe transmission
            let encoded_url = urlencode(original_url);

            // Construct the new proxy URL
            let proxy_url = `http://${host}:${port}/${encoded_url}`;

            // Log the URL rewrite for debugging
            log_debug(`Rewriting subgraph ${subgraph} URL: ${original_url} => ${host}:${port}/${encoded_url}`);

            // Update the request URI
            req.subgraph.uri.scheme = "http";
            req.subgraph.uri.host = host;
            req.subgraph.uri.port = port;
            req.subgraph.uri.path = "/" + encoded_url;

            // Add custom header to indicate proxy routing
            req.subgraph.headers["x-routed-via-proxy"] = "true";
            req.subgraph.headers["x-original-subgraph-url"] = original_url;
            req.subgraph.headers["x-subgraph-name"] = subgraph;
        });
    } else {
        log_info("Mocking proxy disabled - using direct subgraph URLs");
    }
}

fn extract_url_details(url) {
    // Extract scheme
    let scheme_end = url.index_of("://");
    let scheme = url.sub_string(0, scheme_end);
    let remainder = url.sub_string(scheme_end + 3);

    // Extract authority (up to /)
    let path_start = remainder.index_of("/");
    if path_start == -1 { path_start = remainder.len(); }
    let authority = remainder.sub_string(0, path_start);

    // Split host and port
    let colon_index = authority.index_of(":");
    let host = authority;
    let port = 80;
    if colon_index != () {
        host = authority.sub_string(0, colon_index);
        let port_string = authority.sub_string(colon_index + 1);
        if port_string.len() > 0 {
            try {
                port = port_string.parse_int();
            } catch (err) {
                log_warn(`Invalid port: ${port_string}, defaulting to ${port}`);
            }
        }
    }

    return #{ host: host, port: port };
}
