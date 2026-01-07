# Security Policy

## Supported Versions

We currently support the latest major version of this package.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of `pino-graylog-transport` seriously. If you discover a security vulnerability, please **do not open a public issue**.

### Preferred Method
Please report vulnerabilities privately using [GitHub Security Advisories](https://github.com/alex-michaud/pino-graylog-transport/security/advisories/new). This allows us to discuss and fix the issue before it is disclosed to the public.

If the "Report a vulnerability" button is not available, please contact the maintainer directly or open a generic issue asking for a private communication channel without disclosing details.

## Security Best Practices

### Transport Security (TLS vs TCP/UDP)

This library supports multiple protocols (`tls`, `tcp`, `udp`).

1.  **TLS (`protocol: 'tls'`) - Recommended**
    *   **Default:** Yes (since v1.0.0)
    *   **Usage:** Production, remote logging, public networks.
    *   **Why:** Encrypts log data in transit. preventing interception of sensitive information and authentication tokens.

2.  **TCP (`protocol: 'tcp'`)**
    *   **Default:** No.
    *   **Usage:** Local development (localhost), Docker sidecars, or strictly trusted private networks.
    *   **Risk:** sending logs in plaintext.

3.  **UDP (`protocol: 'udp'`)**
    *   **Default:** No.
    *   **Usage:** High-throughput scenarios where occasional message loss is acceptable.
    *   **Risk:** Sending logs in plaintext; no delivery guarantees.

### Sensitive Data

If you use `staticMeta` to send authentication tokens (e.g. `X-OVH-TOKEN`):
*   Ensure you are using **TLS**.
*   Do not commit tokens to your source code; use environment variables.

