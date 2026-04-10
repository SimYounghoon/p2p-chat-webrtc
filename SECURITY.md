# Security Notice

## Status

This project is archived and no longer maintained.

- No new security fixes are planned.
- No compatibility fixes are guaranteed.
- Use at your own risk.

## Critical limitations

1. **Peer IP exposure**  
   Even if the UI does not display IP addresses, WebRTC peers can still learn network information during connection setup.

2. **No peer identity verification**  
   Anyone with the invite link and passphrase may attempt to join. The app does not authenticate who the remote peer actually is.

3. **Passphrase strength matters**  
   Invite payload protection depends heavily on the secrecy and entropy of the passphrase.

4. **No TURN relay**  
   Connectivity is not guaranteed across restrictive NATs or corporate/mobile networks.

5. **No moderation or server-side controls**  
   There is no central authority for blocking, auditing, or forcibly disconnecting abusive peers.

6. **Archived project risk**  
   Future browser, WebRTC, or dependency vulnerabilities may remain unpatched.

## Recommendation

Do not treat this repository as a production-secure messaging service.
