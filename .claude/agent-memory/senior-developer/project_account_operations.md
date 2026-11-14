---
name: account-operations
description: Change password / change e-mail / profile PATCH design decisions (confirm-before-effect, 400 not 401, loan borrowerEmail migration)
type: project
---

Account operations (built 2026-11-14): `POST auth/change-password`, `POST users/me/email-change`, public `POST auth/confirm-email-change`.

- Wrong current password is 400 `current_password_incorrect`, never 401. **Why:** the frontend treats 401 as "session expired" and signs out. **How to apply:** any future re-auth check (2FA setup, account deletion) should reuse `CurrentPasswordVerifier` in users module.
- E-mail change is confirm-before-effect (address = login id + reset address). Only `pass_loans.borrower_email` is keyed on email; live loans (pending/accepted) are migrated on confirm. Everything else is by user id.
- Password change revokes all refresh tokens then issues a fresh session for the caller (`AuthService.issueSession`). Pending email-change tokens die via password fingerprint, not by being marked used.
- Circularity: AuthModule imports UsersModule, so shared account code lives in UsersModule (verifier, EmailChangeService) and AuthController uses it.
