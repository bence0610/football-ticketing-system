# KTE Jegyportál – Product Backlog

**Project:** KTE Jegyportál (Kecskeméti TE Official Ticketing Platform)
**Status:** In Progress
**Overall Completion:** 79% (54 / 68 tasks completed)

---

## Backlog Statistics

| Metric | Value |
|---|---|
| Total Epics | 10 |
| Total User Stories | 68 |
| Completed Stories | 54 |
| Completion | 79% |

---

## Epic Overview

| Epic | Title | Stories | Status |
|---|---|---|---|
| E1 | Project Foundation & Infrastructure | 7 | DONE |
| E2 | Landing Page & Public UI | 5 | DONE |
| E3 | 2.5D Isometric Stadium Map | 7 | DONE |
| E4 | Shopping Cart & Seat Reservation | 5 | DONE |
| E5 | Authentication & User Profile | 7 | DONE |
| E6 | Checkout & Stripe Payment | 6 | DONE |
| E7 | E-ticket Generation & Email Delivery | 5 | DONE |
| E8 | Loyalty Points System | 6 | DONE |
| E9 | Season Pass Loan Flow | 6 | DONE |
| E10 | Advanced Features (Waitlist, AI Chatbot, Weather, Admin) | 14 | Pending |

---

## Iteration Plan

| Iteration | Epics Covered | Status |
|---|---|---|
| Iteration 1 – Foundation | E1 | DONE |
| Iteration 2 – Public Landing & Map | E2, E3 | DONE |
| Iteration 3 – Cart, Auth & Checkout | E4, E5, E6 | DONE |
| Iteration 4 – Tickets, Loyalty & Pass Loan | E7, E8, E9 | DONE |
| Iteration 5 – Advanced Features | E10 | Pending |

---

---

## EPIC E1 – Project Foundation & Infrastructure

> Goal: Establish the full-stack monorepo, database schema, and base configuration so all other epics can build on a stable foundation.

---

### KTE-001 – Monorepo & Project Scaffolding ✅ DONE

**User Story:** As a developer, I want a working monorepo with Angular frontend and NestJS backend scaffolded, so that the team can start feature development immediately without setup friction.

**Acceptance Criteria:**
- [x] Angular 17+ project created with standalone components and strict TypeScript enabled
- [x] NestJS project created with TypeScript strict mode
- [x] Shared `package.json` workspace or Nx/turborepo config in place
- [x] Both apps run locally with `npm start` / `npm run start:dev`
- [x] `.env.example` files present for both frontend and backend

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [FULL]
**Dependencies:** none

---

### KTE-002 – Database Schema & TypeORM Setup ✅ DONE

**User Story:** As a developer, I want the MySQL database connected via TypeORM with all core entities defined, so that all backend modules share a consistent data model.

**Acceptance Criteria:**
- [x] TypeORM connected to MySQL 8+ database
- [x] Entities created: `User`, `Match`, `Seat`, `Ticket`, `SeasonPass`, `PassLoan`, `LoyaltyTransaction`, `Waitlist`
- [x] Migration files generated and runnable (`npm run migration:run`)
- [x] Database seeder creates at least 1 match and a set of seats for testing
- [x] TypeORM logs SQL queries in development mode

**Story Points:** 5
**Priority:** 🔴 Critical
**Layer:** [DB]
**Dependencies:** KTE-001

---

### KTE-003 – Redis Integration & Seat Locking Service ✅ DONE

**User Story:** As a developer, I want Redis connected to the backend with a seat-locking service, so that concurrent seat reservations can be safely handled with TTL-based locks.

**Acceptance Criteria:**
- [x] Redis client configured in NestJS (ioredis or `@nestjs/cache-manager`)
- [x] `SeatLockService` implemented: `lockSeat(seatId, userId, ttl)`, `releaseLock(seatId)`, `isLocked(seatId)`
- [x] Lock TTL set to 300 seconds (5 minutes)
- [x] Unit tests cover lock, release, and expiry scenarios
- [x] Redis connection failure does not crash the app (graceful error handling)

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [BACKEND]
**Dependencies:** KTE-001

---

### KTE-004 – NestJS Module Structure & API Skeleton ✅ DONE

**User Story:** As a developer, I want all NestJS modules (auth, tickets, seats, matches, loyalty, waitlist, admin) created with empty controllers and services, so that feature branches can be developed in parallel without merge conflicts.

**Acceptance Criteria:**
- [x] Modules created: `AuthModule`, `UsersModule`, `MatchesModule`, `SeatsModule`, `TicketsModule`, `LoyaltyModule`, `WaitlistModule`, `AdminModule`, `ChatbotModule`
- [x] Each module has an empty controller with at least one placeholder route returning HTTP 200
- [x] Swagger / OpenAPI doc available at `/api/docs`
- [x] Global validation pipe and exception filter configured

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [BACKEND]
**Dependencies:** KTE-001, KTE-002

---

### KTE-005 – Angular Routing & Core Layout Shell ✅ DONE

**User Story:** As a developer, I want the Angular app to have a core layout shell with header, footer, and lazy-loaded routes, so that all pages can be added without restructuring the app.

**Acceptance Criteria:**
- [x] `AppShellComponent` with `<router-outlet>` renders correctly
- [x] Routes defined: `/`, `/stadium`, `/cart`, `/checkout`, `/profile`, `/admin`
- [x] Routes are lazy-loaded using standalone component imports
- [x] Header shows KTE logo placeholder and navigation links
- [x] 404 page implemented

**Story Points:** 2
**Priority:** 🔴 Critical
**Layer:** [FRONTEND]
**Dependencies:** KTE-001

---

### KTE-006 – Environment Configuration & Secrets Management ✅ DONE

**User Story:** As a developer, I want environment variables managed consistently across frontend and backend, so that no secrets are committed to source control.

**Acceptance Criteria:**
- [x] `.env` files excluded via `.gitignore`
- [x] NestJS `ConfigModule` loads all env vars with validation (`class-validator`)
- [x] Angular `environment.ts` / `environment.prod.ts` files use build-time replacements
- [x] All required env keys documented in `.env.example`

**Story Points:** 1
**Priority:** 🟠 High
**Layer:** [FULL]
**Dependencies:** KTE-001

---

### KTE-007 – CI Pipeline Setup ✅ DONE

**User Story:** As a developer, I want a basic CI pipeline that runs linting and unit tests on every push, so that regressions are caught early.

**Acceptance Criteria:**
- [x] GitHub Actions (or equivalent) workflow file present
- [x] Pipeline runs `ng lint`, `ng test --watch=false` for frontend
- [x] Pipeline runs `npm run lint`, `npm run test` for backend
- [x] Pipeline fails on any test or lint error
- [x] Pipeline completes in under 5 minutes

**Story Points:** 2
**Priority:** 🟡 Medium
**Layer:** [FULL]
**Dependencies:** KTE-001

---

---

## EPIC E2 – Landing Page & Public UI

> Goal: Deliver a compelling public-facing landing page with a countdown timer and match schedule using mocked data.

**UI Design Required:** Yes – this epic requires UI design before implementation.

---

### KTE-008 – Hero Section with Club Branding ✅ DONE

**User Story:** As a visitor, I want to see a visually striking hero section on the landing page, so that I immediately understand this is the official KTE ticketing platform.

**Acceptance Criteria:**
- [x] Hero section displays KTE club name, tagline, and a "Buy Tickets" CTA button
- [x] Background is a full-width image or gradient with KTE colors
- [x] CTA button navigates to the stadium map page
- [x] Hero is fully responsive (mobile, tablet, desktop)
- [x] Passes Lighthouse accessibility score >= 90

**Story Points:** 2
**Priority:** 🔴 Critical
**Layer:** [FRONTEND]
**Dependencies:** KTE-005

---

### KTE-009 – Countdown Timer to Next Match ✅ DONE

**User Story:** As a visitor, I want to see a live countdown timer to the next home match, so that I feel the urgency and excitement of an upcoming game.

**Acceptance Criteria:**
- [x] Countdown displays days, hours, minutes, seconds and updates every second (RxJS interval)
- [x] Countdown target date is read from the mocked match schedule (next future match)
- [x] When the countdown reaches zero, the "Buy Tickets" button label changes to "Match Has Started!" and links to gate-opening info
- [x] Countdown handles timezone correctly (Europe/Budapest)

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [FRONTEND]
**Dependencies:** KTE-008

---

### KTE-010 – Static Match Schedule Section ✅ DONE

**User Story:** As a visitor, I want to see a list of upcoming matches on the landing page, so that I can plan which games to attend.

**Acceptance Criteria:**
- [x] Displays at least 5 upcoming matches from a mocked JSON fixture
- [x] Each match card shows: date, time, opponent, home/away indicator
- [x] "Buy Tickets" link per match navigates to the stadium map with the correct matchId query param
- [x] Section is responsive and accessible (ARIA labels on interactive elements)

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [FRONTEND]
**Dependencies:** KTE-008

---

### KTE-011 – Matches API Endpoint (Backend) ✅ DONE

**User Story:** As a frontend developer, I want a `/api/matches` endpoint returning upcoming matches, so that the landing page and other pages can fetch live match data.

**Acceptance Criteria:**
- [x] `GET /api/matches` returns array of matches (id, opponent, date, venue, status)
- [x] `GET /api/matches/:id` returns a single match with seat availability summary
- [x] Matches are seeded via the database seeder (at least 5 future matches)
- [x] Endpoint is publicly accessible (no auth required)
- [x] Response schema validated with Swagger decorator

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [BACKEND]
**Dependencies:** KTE-002, KTE-004

---

### KTE-012 – Angular Match Service & Data Integration ✅ DONE

**User Story:** As a developer, I want an Angular `MatchService` that fetches match data from the backend, so that all UI components share a single data source for match information.

**Acceptance Criteria:**
- [x] `MatchService` uses `HttpClient` to call `/api/matches`
- [x] Returns typed `Match[]` using a shared interface
- [x] Service is used by the landing page countdown and schedule components
- [x] Loading and error states are handled and displayed in the UI
- [x] Unit tests cover success and error responses

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [FRONTEND]
**Dependencies:** KTE-011

---

---

## EPIC E3 – 2.5D Isometric Stadium Map

> Goal: Deliver an interactive 2.5D SVG stadium map where users can browse sectors, select individual seats, and view seat details.

**UI Design Required:** Yes – the isometric SVG map requires a Paper design before implementation.

---

### KTE-013 – SVG Stadium Map Base Rendering ✅ DONE

**User Story:** As a user, I want to see a 2.5D isometric SVG map of the stadium, so that I can visually understand the seating layout.

**Acceptance Criteria:**
- [x] SVG map renders all stadium sectors in isometric perspective
- [x] Sectors are grouped and labeled (e.g., North Stand, South Stand, VIP, Accessible)
- [x] Map is zoomable and pannable on desktop and touch devices
- [x] SVG scales responsively without distortion
- [x] Map loads in under 2 seconds on a standard connection

**Story Points:** 5
**Priority:** 🔴 Critical
**Layer:** [FRONTEND]
**Dependencies:** KTE-005

---

### KTE-014 – Seat Color Coding (Free / Occupied / VIP / Accessible) ✅ DONE

**User Story:** As a user, I want seats to be color-coded by status, so that I can instantly see which seats are available, occupied, VIP, or accessible.

**Acceptance Criteria:**
- [x] Free seats: green
- [x] Occupied seats: red (non-clickable)
- [x] VIP seats: gold
- [x] Accessible seats: blue with wheelchair icon
- [x] Color legend displayed adjacent to the map
- [x] Colors meet WCAG AA contrast ratio requirements

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [FRONTEND]
**Dependencies:** KTE-013

---

### KTE-015 – Seats API Endpoint ✅ DONE

**User Story:** As a frontend developer, I want a `/api/seats` endpoint that returns seat availability per match, so that the stadium map can reflect real-time occupancy.

**Acceptance Criteria:**
- [x] `GET /api/seats?matchId=:id` returns all seats with fields: id, sector, row, number, category, isAccessible, status (free/occupied/locked)
- [x] Locked seats (Redis TTL active) are returned with status `locked`
- [x] Response is pageable or limited to 1 match at a time
- [x] Endpoint is publicly accessible
- [x] Response time < 200ms for up to 5,000 seats

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [BACKEND]
**Dependencies:** KTE-002, KTE-003, KTE-004

---

### KTE-016 – Seat Click & Detail Panel ✅ DONE

**User Story:** As a user, I want to click a seat on the map and see its details in a side panel, so that I can make an informed decision before adding it to my cart.

**Acceptance Criteria:**
- [x] Clicking a free seat opens a detail panel without page reload
- [x] Panel shows: sector name, row, seat number, price, category (Standard/VIP/Accessible)
- [x] Panel has an "Add to Cart" button
- [x] Clicking an occupied or locked seat shows a "Seat Unavailable" message
- [x] Panel can be dismissed by clicking elsewhere or pressing Escape

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [FRONTEND]
**Dependencies:** KTE-013, KTE-015

---

### KTE-017 – Accessibility Toggle (Wheelchair Filter) ✅ DONE

**User Story:** As a user with accessibility needs, I want to toggle an accessibility filter on the map, so that only wheelchair-accessible seats remain active and all others are grayed out.

**Acceptance Criteria:**
- [x] Toggle button is clearly visible and labeled "Accessible Seats Only"
- [x] When active, non-accessible seats are visually grayed out and non-clickable
- [x] Accessible seats remain fully interactive when toggle is on
- [x] Toggle state persists during the user session (Angular signal or service)
- [x] Toggle is keyboard-accessible (Tab + Space/Enter)

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [FRONTEND]
**Dependencies:** KTE-014

---

### KTE-018 – Sector Overview Panel ✅ DONE

**User Story:** As a user, I want to click on a sector to see a summary of available and occupied seats before zooming in, so that I can quickly decide which area interests me.

**Acceptance Criteria:**
- [x] Clicking a sector (not a seat) shows a sector summary tooltip or panel
- [x] Panel shows: sector name, total seats, free seats, price range, category
- [x] "View Seats" button zooms the map into that sector
- [x] Sector hover state is visually distinct from seat hover state

**Story Points:** 3
**Priority:** 🟡 Medium
**Layer:** [FRONTEND]
**Dependencies:** KTE-013, KTE-015

---

### KTE-019 – Real-time Seat Status Updates (Polling) ✅ DONE

**User Story:** As a user, I want the seat map to refresh availability automatically, so that I always see up-to-date seat status without manually reloading the page.

**Acceptance Criteria:**
- [x] Frontend polls `GET /api/seats?matchId=:id` every 30 seconds
- [x] Newly occupied or locked seats update visually without full page reload
- [x] Polling stops when user navigates away from the map page
- [x] No visible flicker or layout shift during update

**Story Points:** 2
**Priority:** 🟡 Medium
**Layer:** [FRONTEND]
**Dependencies:** KTE-015, KTE-016

---

---

## EPIC E4 – Shopping Cart & Seat Reservation

> Goal: Allow users to add seats to a cart, lock them temporarily in Redis, and see a countdown timer before the reservation expires.

---

### KTE-020 – Cart State Management (Angular) ✅ DONE

**User Story:** As a user, I want a persistent shopping cart during my session, so that I can select multiple seats before proceeding to checkout.

**Acceptance Criteria:**
- [x] Cart stores selected seats (id, sector, row, number, price) in an Angular service (signal-based)
- [x] Maximum 6 seats per cart
- [x] Cart is accessible via a cart icon in the header showing item count badge
- [x] Cart persists across route changes within the same session
- [x] Cart is cleared after successful checkout or session expiry

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [FRONTEND]
**Dependencies:** KTE-016

---

### KTE-021 – Seat Lock API Endpoint ✅ DONE

**User Story:** As a backend developer, I want a seat-locking endpoint that reserves a seat for 5 minutes in Redis when a user adds it to their cart, so that two users cannot buy the same seat simultaneously.

**Acceptance Criteria:**
- [x] `POST /api/seats/:id/lock` locks the seat in Redis for 300 seconds, tagged with `userId`
- [x] Returns 409 Conflict if seat is already locked or occupied
- [x] `DELETE /api/seats/:id/lock` releases the lock (called on cart removal)
- [x] Only authenticated users can lock seats (JWT guard)
- [x] Lock is automatically released when TTL expires

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [BACKEND]
**Dependencies:** KTE-003, KTE-004

---

### KTE-022 – 5-Minute Reservation Countdown in Cart ✅ DONE

**User Story:** As a user, I want to see a 5-minute countdown timer per seat in my cart, so that I know how long my seat reservation lasts.

**Acceptance Criteria:**
- [x] Each cart item shows an individual countdown (mm:ss) from the moment of locking
- [x] When a countdown reaches 0, the seat is removed from the cart and a toast notification appears
- [x] User is prompted to re-select the seat if the lock expires
- [x] Timer is driven by the lock timestamp returned from the lock API

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [FRONTEND]
**Dependencies:** KTE-020, KTE-021

---

### KTE-023 – Cart Summary Page ✅ DONE

**User Story:** As a user, I want to review my selected seats on a cart summary page before checkout, so that I can confirm my choices and see the total price.

**Acceptance Criteria:**
- [x] Cart page lists all selected seats with details: sector, row, seat number, price
- [x] Total price is calculated and displayed prominently
- [x] User can remove individual seats from the cart
- [x] "Proceed to Checkout" button is disabled if cart is empty
- [x] Page shows remaining lock time for each seat

**Story Points:** 2
**Priority:** 🔴 Critical
**Layer:** [FRONTEND]
**Dependencies:** KTE-020, KTE-022

---

### KTE-024 – Guest vs. Authenticated Cart Flow ✅ DONE

**User Story:** As a guest user, I want to browse and add seats to a cart, and be prompted to log in only when I proceed to checkout, so that the purchase flow is not blocked unnecessarily.

**Acceptance Criteria:**
- [x] Guests can add seats to the cart and view the cart summary
- [x] Clicking "Proceed to Checkout" redirects unauthenticated users to the login page with a `returnUrl` query param
- [x] After login, the user is redirected back to checkout with cart intact
- [x] Guest cart is stored in `sessionStorage`

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [FRONTEND]
**Dependencies:** KTE-020

---

---

## EPIC E5 – Authentication & User Profile

> Goal: Implement JWT-based registration and login, and deliver a user profile page showing active tickets, purchase history, and loyalty points.

**UI Design Required:** Yes – profile and login/register pages require UI design before implementation.

---

### KTE-025 – User Registration API ✅ DONE

**User Story:** As a new user, I want to register with my email and password, so that I can access personalized features like ticket history and loyalty points.

**Acceptance Criteria:**
- [x] `POST /api/auth/register` accepts email, password, name
- [x] Password is hashed with bcrypt (min rounds: 12)
- [x] Duplicate email returns 409 Conflict
- [x] Registration awards +100 loyalty points (initial bonus)
- [x] Returns JWT access token and refresh token on success

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [BACKEND]
**Dependencies:** KTE-002, KTE-004

---

### KTE-026 – User Login API & JWT Auth Guard ✅ DONE

**User Story:** As a registered user, I want to log in with my email and password and receive a JWT, so that I can access protected features securely.

**Acceptance Criteria:**
- [x] `POST /api/auth/login` validates credentials and returns access + refresh JWT
- [x] Access token expires in 15 minutes; refresh token in 7 days
- [x] `POST /api/auth/refresh` issues a new access token using a valid refresh token
- [x] `POST /api/auth/logout` invalidates the refresh token (Redis blacklist or DB flag)
- [x] NestJS `JwtAuthGuard` protects all authenticated routes

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [BACKEND]
**Dependencies:** KTE-025

---

### KTE-027 – Angular Auth Service & Token Management ✅ DONE

**User Story:** As a developer, I want an Angular `AuthService` that handles login, logout, token storage, and automatic token refresh, so that all components can rely on a consistent authentication state.

**Acceptance Criteria:**
- [x] `AuthService` stores access token in memory (not localStorage for XSS protection); refresh token in `HttpOnly` cookie
- [x] Automatic silent refresh before token expiry using an Angular HTTP interceptor
- [x] `isAuthenticated$` observable for components to react to auth state changes
- [x] Logout clears all tokens and redirects to home
- [x] Unit tests cover login, logout, and token refresh flows

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [FRONTEND]
**Dependencies:** KTE-026

---

### KTE-028 – Login & Registration UI Pages ✅ DONE

**User Story:** As a user, I want clean login and registration pages, so that I can sign up or sign in quickly without confusion.

**Acceptance Criteria:**
- [x] Login page: email + password fields, "Log In" button, link to registration
- [x] Registration page: name, email, password, confirm password fields with validation
- [x] Form validation errors shown inline (required, email format, password min length 8)
- [x] Successful login redirects to `returnUrl` or home
- [x] Pages are responsive and accessible

**Story Points:** 2
**Priority:** 🔴 Critical
**Layer:** [FRONTEND]
**Dependencies:** KTE-027

---

### KTE-029 – User Profile Page ✅ DONE

**User Story:** As a logged-in user, I want a profile page showing my account information, active tickets, and purchase history, so that I can manage my purchases in one place.

**Acceptance Criteria:**
- [x] Profile page shows: name, email, loyalty tier badge, loyalty points balance
- [x] Active tickets section lists upcoming tickets (match, seat, QR code preview)
- [x] Purchase history shows past tickets (match, seat, date, price)
- [x] Data is fetched from `GET /api/users/me/tickets`
- [x] Page is only accessible to authenticated users (route guard)

**Story Points:** 3
**Priority:** 🟠 High
**Layer:** [FULL]
**Dependencies:** KTE-027, KTE-028

---

### KTE-030 – User Profile API Endpoints ✅ DONE

**User Story:** As a backend developer, I want profile and ticket history endpoints, so that the frontend profile page can display accurate user data.

**Acceptance Criteria:**
- [x] `GET /api/users/me` returns user profile (name, email, loyaltyPoints, loyaltyTier)
- [x] `GET /api/users/me/tickets` returns active and past tickets with match and seat details
- [x] All endpoints protected by `JwtAuthGuard`
- [x] Pagination supported on ticket history (limit/offset)
- [x] 401 returned for unauthenticated requests

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [BACKEND]
**Dependencies:** KTE-026, KTE-002

---

### KTE-031 – Route Guards & Auth State in Angular ✅ DONE

**User Story:** As a developer, I want Angular route guards protecting authenticated pages, so that unauthenticated users are redirected to login automatically.

**Acceptance Criteria:**
- [x] `AuthGuard` functional guard redirects to `/login?returnUrl=...` for protected routes
- [x] `GuestGuard` redirects authenticated users away from login/register pages
- [x] Guards applied to: `/profile`, `/checkout`, `/admin`
- [x] Guard uses `AuthService.isAuthenticated$` to determine state

**Story Points:** 1
**Priority:** 🟠 High
**Layer:** [FRONTEND]
**Dependencies:** KTE-027

---

---

## EPIC E6 – Checkout & Stripe Payment

> Goal: Implement a checkout flow with simulated Stripe payment in test mode, including a weather warning banner for uncovered sectors.

---

### KTE-032 – Checkout Page UI ✅ DONE

**User Story:** As a user, I want a clear checkout page summarizing my order, so that I can review and confirm before payment.

**Acceptance Criteria:**
- [x] Shows order summary: seats, prices, total
- [x] Shows user info (name, email) pre-filled from profile
- [x] "Pay Now" button triggers Stripe payment
- [x] Back button returns to cart without losing cart state
- [x] Page is only accessible to authenticated users

**Story Points:** 2
**Priority:** 🔴 Critical
**Layer:** [FRONTEND]
**Dependencies:** KTE-023, KTE-027

---

### KTE-033 – Stripe Payment Intent API ✅ DONE

**User Story:** As a backend developer, I want a Stripe PaymentIntent endpoint, so that the frontend can securely initiate and confirm payments in test mode.

**Acceptance Criteria:**
- [x] `POST /api/payments/create-intent` creates a Stripe PaymentIntent with the cart total
- [x] Returns `clientSecret` to the frontend
- [x] Stripe webhook `POST /api/payments/webhook` listens for `payment_intent.succeeded` event
- [x] Webhook signature is verified using Stripe signing secret
- [x] On success, ticket records are created and seat locks released

**Story Points:** 5
**Priority:** 🔴 Critical
**Layer:** [BACKEND]
**Dependencies:** KTE-002, KTE-003, KTE-004

---

### KTE-034 – Stripe Elements Integration (Frontend) ✅ DONE

**User Story:** As a user, I want to enter my card details using Stripe Elements on the checkout page, so that my payment data is handled securely by Stripe.

**Acceptance Criteria:**
- [x] Stripe.js loaded and `CardElement` rendered in the checkout form
- [x] On "Pay Now", `stripe.confirmCardPayment(clientSecret)` is called with the card element
- [x] Success redirects to the e-ticket confirmation page
- [x] Decline or error shows an inline error message with Stripe's error message
- [x] Loading spinner shown during payment processing

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [FRONTEND]
**Dependencies:** KTE-032, KTE-033

---

### KTE-035 – Weather Warning Banner ✅ DONE

**User Story:** As a user purchasing a seat in an uncovered sector, I want to see a weather warning if rain is forecast on match day, so that I can decide whether to switch to a covered sector.

**Acceptance Criteria:**
- [x] Backend calls OpenWeatherMap API for the match city (Kecskemét) on match date
- [x] If precipitation > 0.5mm/h is forecast and the selected sector is uncovered, a warning banner is shown on the checkout page
- [x] Banner includes: rain probability, option to switch sector (link back to map)
- [x] Warning is not shown for covered sectors or if weather is clear
- [x] API call is cached in Redis for 1 hour to avoid rate limit issues

**Story Points:** 3
**Priority:** 🟡 Medium
**Layer:** [FULL]
**Dependencies:** KTE-032, KTE-033

---

### KTE-036 – Order Confirmation Page ✅ DONE

**User Story:** As a user, I want to see a confirmation page after successful payment, so that I know my purchase was completed and my tickets are being prepared.

**Acceptance Criteria:**
- [x] Confirmation page shows: order ID, purchased seats list, total paid
- [x] Message informs user that e-tickets will arrive by email
- [x] "Go to Profile" and "Back to Home" buttons present
- [x] Page is not accessible without a completed payment (guard via query param or state)

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [FRONTEND]
**Dependencies:** KTE-034

---

### KTE-037 – Payment Error & Retry Handling ✅ DONE

**User Story:** As a user, I want clear error messages if my payment fails and the option to retry, so that I do not lose my seat reservation unnecessarily.

**Acceptance Criteria:**
- [x] Payment decline shows specific Stripe decline message (e.g., "Insufficient funds")
- [x] Seat locks are extended by 2 minutes on payment failure to allow retry
- [x] "Try Again" button re-initiates payment without navigating away
- [x] After 3 consecutive failures, user is shown a support contact option
- [x] Network error is handled separately from card decline

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [FULL]
**Dependencies:** KTE-034

---

---

## EPIC E7 – E-ticket Generation & Email Delivery

> Goal: Generate QR-code based e-tickets after successful payment and deliver them via email using Nodemailer.

---

### KTE-038 – QR Code Generation Service ✅ DONE

**User Story:** As a backend developer, I want a service that generates a unique QR code for each purchased ticket, so that tickets can be scanned at the stadium gate.

**Acceptance Criteria:**
- [x] `QrCodeService.generate(ticketId)` produces a unique QR code as a base64 PNG
- [x] QR code encodes: ticketId, matchId, seatId, userId (JWT-signed payload)
- [x] QR code is stored in the `Ticket` entity (base64 or file path)
- [x] QR code can be regenerated if corrupted (admin action)
- [x] Unit tests validate QR code generation output

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [BACKEND]
**Dependencies:** KTE-033

---

### KTE-039 – E-ticket PDF / HTML Generation ✅ DONE

**User Story:** As a user, I want my e-ticket to be a well-formatted document with match details, seat info, and QR code, so that I can easily present it at the gate.

**Acceptance Criteria:**
- [x] E-ticket contains: KTE logo, match name, date, sector, row, seat number, QR code
- [x] Generated as HTML (inline CSS for email compatibility) or PDF
- [x] Ticket template is consistent with KTE branding (colors, fonts)
- [x] Accessible (alt text on images)

**Story Points:** 2
**Priority:** 🔴 Critical
**Layer:** [BACKEND]
**Dependencies:** KTE-038

---

### KTE-040 – Email Delivery via Nodemailer ✅ DONE

**User Story:** As a user, I want to receive my e-ticket by email after successful payment, so that I always have a copy even if the app is unavailable.

**Acceptance Criteria:**
- [x] `EmailService` configured with Nodemailer + SMTP credentials from env vars
- [x] After payment webhook success, e-ticket email is sent within 30 seconds
- [x] Email subject: "Your KTE Tickets – [Match Name]"
- [x] Email contains HTML ticket(s) as inline or attachment
- [x] Failed email sends are logged and retried once after 60 seconds

**Story Points:** 3
**Priority:** 🔴 Critical
**Layer:** [BACKEND]
**Dependencies:** KTE-039

---

### KTE-041 – E-ticket View in User Profile ✅ DONE

**User Story:** As a logged-in user, I want to view and download my e-tickets from my profile, so that I have access to them without checking my email.

**Acceptance Criteria:**
- [x] Profile page active tickets section shows QR code image per ticket
- [x] "Download Ticket" button downloads the ticket as PDF or image
- [x] QR code is fetched from `GET /api/tickets/:id/qr`
- [x] Past tickets show QR codes but are visually marked as "Used" or "Expired"

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [FULL]
**Dependencies:** KTE-029, KTE-038

---

### KTE-042 – Ticket Status Management API ✅ DONE

**User Story:** As a backend developer, I want ticket status transitions (active → used → expired) managed via API, so that the system can track which tickets have been scanned.

**Acceptance Criteria:**
- [x] `PATCH /api/tickets/:id/scan` marks ticket as `used` (admin/gate scanner role required)
- [x] `GET /api/tickets/:id` returns current ticket status
- [x] Expired tickets (match date passed) are automatically set to `expired` via a scheduled job
- [x] Status transitions are logged in the ticket entity with timestamp

**Story Points:** 3
**Priority:** 🟡 Medium
**Layer:** [BACKEND]
**Dependencies:** KTE-038

---

---

## EPIC E8 – Loyalty Points System

> Goal: Award loyalty points for purchases and actions, display tier progress in a dashboard, and apply tier-based discounts at checkout.

**UI Design Required:** Yes – the loyalty dashboard requires UI design before implementation.

---

### KTE-043 – Loyalty Points Engine (Backend) ✅ DONE

**User Story:** As a backend developer, I want a `LoyaltyService` that awards points for defined events, so that the loyalty program runs automatically without manual intervention.

**Acceptance Criteria:**
- [x] Points awarded: registration +100, profile completion +50, ticket purchase +50/ticket, season pass +500, pass loan +25
- [x] Each award creates a `LoyaltyTransaction` record (userId, points, reason, createdAt)
- [x] Current tier calculated from total points: Kék (0–499), Ezüst (500–1999), Arany (2000–4999), KTE Legenda (5000+)
- [x] Tier is stored on the `User` entity and updated after each transaction
- [x] Unit tests cover each point-awarding event

**Story Points:** 3
**Priority:** 🟠 High
**Layer:** [BACKEND]
**Dependencies:** KTE-002, KTE-004

---

### KTE-044 – Loyalty Points API Endpoints ✅ DONE

**User Story:** As a frontend developer, I want loyalty API endpoints, so that the profile page and loyalty dashboard can display accurate points data.

**Acceptance Criteria:**
- [x] `GET /api/loyalty/me` returns: totalPoints, tier, nextTierPoints, transactions (last 20)
- [x] `GET /api/loyalty/tiers` returns tier definitions (name, minPoints, benefits)
- [x] All endpoints protected by `JwtAuthGuard`
- [x] Tier upgrade event returned as a flag in response for frontend notification

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [BACKEND]
**Dependencies:** KTE-043

---

### KTE-045 – Loyalty Dashboard UI ✅ DONE

**User Story:** As a logged-in user, I want a loyalty points dashboard, so that I can see my current tier, points breakdown, and what rewards I am entitled to.

**Acceptance Criteria:**
- [x] Dashboard shows: current tier badge with color, total points, progress bar to next tier
- [x] Tier benefits listed for current and next tier
- [x] Transaction history table: date, reason, points earned/spent
- [x] Tier upgrade is celebrated with a toast notification when detected
- [x] Dashboard accessible from profile page navigation

**Story Points:** 3
**Priority:** 🟠 High
**Layer:** [FRONTEND]
**Dependencies:** KTE-044, KTE-029

---

### KTE-046 – Tier-Based Discount at Checkout ✅ DONE

**User Story:** As a loyalty tier member, I want my tier discount automatically applied at checkout, so that I receive the benefit of my loyalty status without manual coupon codes.

**Acceptance Criteria:**
- [x] Backend reads user's tier at checkout and applies: Ezüst 5%, Arany 10%, KTE Legenda 15%
- [x] Discounted price shown on checkout page before payment
- [x] Discount is applied server-side in the Stripe PaymentIntent amount
- [x] Discount label shown in order summary: "Arany Member Discount: -10%"
- [x] No discount applied for Kék tier

**Story Points:** 2
**Priority:** 🟡 Medium
**Layer:** [FULL]
**Dependencies:** KTE-033, KTE-043

---

### KTE-047 – Loyalty Points for Profile Completion ✅ DONE

**User Story:** As a registered user, I want to earn 50 loyalty points when I complete my profile, so that I am incentivized to provide my details.

**Acceptance Criteria:**
- [x] Profile completion means: name, phone number, and profile picture set
- [x] `PATCH /api/users/me` triggers point award if all required fields are now set for the first time
- [x] Award is idempotent (not repeated if profile is edited again)
- [x] Toast notification informs user of points earned after save

**Story Points:** 2
**Priority:** 🟡 Medium
**Layer:** [FULL]
**Dependencies:** KTE-043, KTE-029

---

### KTE-048 – Season-End Points Carryover Job ✅ DONE

**User Story:** As a developer, I want a scheduled job that carries over 50% of loyalty points at the end of each season, so that the loyalty program resets partially for the next season.

**Acceptance Criteria:**
- [x] Cron job runs on a configurable date (default: end of football season, ~June 30)
- [x] Each user's points are reduced to 50% and a `LoyaltyTransaction` is recorded (reason: "Season carryover")
- [x] Tier is recalculated after carryover
- [x] Job is idempotent (safe to re-run)
- [x] Job execution is logged

**Story Points:** 2
**Priority:** 🟢 Low
**Layer:** [BACKEND]
**Dependencies:** KTE-043

---

---

## EPIC E9 – Season Pass Loan Flow

> Goal: Allow season pass holders to loan their seat for a specific match to another registered user via QR code, with email confirmation and automatic release after the match.

---

### KTE-049 – Season Pass Entity & API ✅ DONE

**User Story:** As a backend developer, I want `SeasonPass` and `PassLoan` entities with CRUD endpoints, so that the pass loan flow has a proper data foundation.

**Acceptance Criteria:**
- [x] `SeasonPass` entity: userId, seatId, validFrom, validTo, status (active/suspended)
- [x] `PassLoan` entity: fromUserId, toUserId, matchId, status (pending/active/completed/cancelled)
- [x] `GET /api/season-passes/me` returns user's active passes
- [x] `POST /api/season-passes/:id/loans` creates a new loan request
- [x] All endpoints protected by `JwtAuthGuard`

**Story Points:** 3
**Priority:** 🟠 High
**Layer:** [BACKEND]
**Dependencies:** KTE-002, KTE-004, KTE-026

---

### KTE-050 – Loan QR Code Generation ✅ DONE

**User Story:** As a season pass holder, I want to generate a one-time QR code for a specific match loan, so that the recipient can access the seat without physical handover.

**Acceptance Criteria:**
- [x] `POST /api/season-passes/:id/loans/:loanId/qr` generates a signed, one-time QR code
- [x] QR code encodes: loanId, matchId, seatId, recipientUserId
- [x] QR code expires after the match start time
- [x] Generating a new QR for the same loan invalidates the previous one
- [x] QR code is returned as base64 PNG

**Story Points:** 3
**Priority:** 🟠 High
**Layer:** [BACKEND]
**Dependencies:** KTE-049, KTE-038

---

### KTE-051 – Loan Initiation UI ✅ DONE

**User Story:** As a season pass holder, I want a UI to select a match and recipient for my pass loan, so that I can easily delegate my seat without leaving the app.

**Acceptance Criteria:**
- [x] Pass loan flow accessible from the profile page (active passes section)
- [x] Step 1: Select match from a dropdown of upcoming matches
- [x] Step 2: Enter recipient's registered email address
- [x] Step 3: Review and confirm loan
- [x] Confirmation shows the generated QR code for the pass holder to share

**Story Points:** 3
**Priority:** 🟠 High
**Layer:** [FRONTEND]
**Dependencies:** KTE-049, KTE-029

---

### KTE-052 – Loan Email Notifications ✅ DONE

**User Story:** As both the lender and the recipient of a pass loan, I want to receive email notifications, so that we are both informed about the loan status.

**Acceptance Criteria:**
- [x] Lender receives email: "You have loaned your pass for [Match] to [RecipientName]"
- [x] Recipient receives email: "You have received a pass loan for [Match]" with QR code attached
- [x] Both emails sent within 60 seconds of loan confirmation
- [x] Email uses Nodemailer (same `EmailService` as tickets)

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [BACKEND]
**Dependencies:** KTE-050, KTE-040

---

### KTE-053 – Automatic Loan Release After Match ✅ DONE

**User Story:** As a developer, I want loan records automatically closed after a match ends, so that the season pass reverts to the holder without manual action.

**Acceptance Criteria:**
- [x] Cron job runs every hour and sets `PassLoan.status = completed` for loans where the match has ended
- [x] `SeasonPass` status returns to `active` after loan completion
- [x] Loyalty points (+25) awarded to lender upon loan completion
- [x] Job is idempotent and logged

**Story Points:** 2
**Priority:** 🟡 Medium
**Layer:** [BACKEND]
**Dependencies:** KTE-049, KTE-043

---

### KTE-054 – Loan Cancellation Flow ✅ DONE

**User Story:** As a season pass holder, I want to cancel an active loan before the match, so that I can reclaim my seat if my plans change.

**Acceptance Criteria:**
- [x] `DELETE /api/season-passes/:id/loans/:loanId` cancels a pending or active loan
- [x] Cancellation only allowed before match kickoff
- [x] Recipient is notified by email of the cancellation
- [x] Loan status set to `cancelled` and loyalty points for the loan are reversed

**Story Points:** 2
**Priority:** 🟡 Medium
**Layer:** [FULL]
**Dependencies:** KTE-052

---

---

## EPIC E10 – Advanced Features (Waitlist, AI Chatbot, Weather, Admin)

> Goal: Add the remaining POC features: sold-out waitlist, AI chatbot widget, weather API integration, and admin dashboard.

---

### KTE-055 – Waitlist System (Backend)

**User Story:** As a backend developer, I want a waitlist state machine for sold-out matches, so that users can queue for seats that become available.

**Acceptance Criteria:**
- [ ] `Waitlist` entity: userId, matchId, position, status (waiting/notified/claimed/expired)
- [ ] `POST /api/waitlist/:matchId/join` adds user to waitlist (if match is sold out)
- [ ] When a seat is released (lock expiry or loan), the first waitlisted user is notified by email
- [ ] Notification email contains a 10-minute claim link
- [ ] If claim link expires, next waitlisted user is notified automatically

**Story Points:** 5
**Priority:** 🟠 High
**Layer:** [BACKEND]
**Dependencies:** KTE-002, KTE-003, KTE-004, KTE-040

---

### KTE-056 – Waitlist Notification Timer (Redis)

**User Story:** As a developer, I want the 10-minute claim window enforced by Redis TTL, so that seat availability is offered to the next user if unclaimed.

**Acceptance Criteria:**
- [ ] When user is notified, a Redis key `waitlist:claim:{userId}:{matchId}` is set with 600s TTL
- [ ] Claim API `POST /api/waitlist/:matchId/claim` validates the Redis key exists before proceeding
- [ ] On TTL expiry (Redis keyspace notification), next waitlisted user is notified
- [ ] Redis keyspace notifications enabled in Redis config

**Story Points:** 3
**Priority:** 🟠 High
**Layer:** [BACKEND]
**Dependencies:** KTE-055

---

### KTE-057 – Waitlist UI Integration

**User Story:** As a user browsing a sold-out match, I want to see a "Join Waitlist" button instead of "Buy Tickets", so that I can register my interest for any released seats.

**Acceptance Criteria:**
- [ ] "Buy Tickets" button replaced with "Join Waitlist" when `match.status === 'sold_out'`
- [ ] Clicking "Join Waitlist" requires authentication (redirect to login if guest)
- [ ] Success toast: "You are #N on the waitlist for [Match]"
- [ ] Waitlist position shown on the user profile page

**Story Points:** 2
**Priority:** 🟠 High
**Layer:** [FRONTEND]
**Dependencies:** KTE-055, KTE-027

---

### KTE-058 – AI Chatbot Backend (Claude API)

**User Story:** As a backend developer, I want a chatbot endpoint powered by the Claude API, so that the frontend widget can relay user questions and receive context-aware answers.

**Acceptance Criteria:**
- [ ] `POST /api/chatbot/message` accepts `{ message: string, sessionContext: object }` payload
- [ ] Backend constructs a system prompt including: current match schedule, user profile (if authenticated), loyalty tier
- [ ] Claude API called with `claude-sonnet-4-20250514` model
- [ ] Response streamed to frontend using Server-Sent Events (SSE) or returned as JSON
- [ ] Rate limited to 20 requests per user per minute (Redis)

**Story Points:** 5
**Priority:** 🟡 Medium
**Layer:** [BACKEND]
**Dependencies:** KTE-004, KTE-003, KTE-026

---

### KTE-059 – Floating Chatbot Widget (Frontend)

**User Story:** As a user, I want a floating chatbot widget in the bottom-right corner, so that I can ask questions about tickets, loyalty, and the stadium without leaving the current page.

**Acceptance Criteria:**
- [ ] Widget visible on all pages as a floating button (chat bubble icon)
- [ ] Clicking the button opens a chat panel (minimizable)
- [ ] User can type a message and receive an AI response
- [ ] Responses rendered as markdown (basic: bold, lists)
- [ ] Chat history cleared on page reload (GDPR: not persisted)
- [ ] Widget does not interfere with page content layout

**Story Points:** 3
**Priority:** 🟡 Medium
**Layer:** [FRONTEND]
**Dependencies:** KTE-058

---

### KTE-060 – Weather API Service (Backend)

**User Story:** As a backend developer, I want a `WeatherService` that fetches weather forecasts from OpenWeatherMap, so that the checkout page can warn users about rain in uncovered sectors.

**Acceptance Criteria:**
- [ ] `WeatherService.getForecast(date, city)` returns precipitation forecast for Kecskemét
- [ ] Result cached in Redis for 1 hour with key `weather:{city}:{date}`
- [ ] Returns `{ willRain: boolean, probability: number, description: string }`
- [ ] API key loaded from environment variables
- [ ] Graceful fallback (no warning shown) if API is unavailable

**Story Points:** 2
**Priority:** 🟡 Medium
**Layer:** [BACKEND]
**Dependencies:** KTE-003, KTE-004

---

### KTE-061 – Admin Dashboard – Seat Occupancy Heatmap

**User Story:** As an admin, I want a real-time seat occupancy heatmap in the admin dashboard, so that I can monitor stadium fill rate per match at a glance.

**Acceptance Criteria:**
- [ ] Admin dashboard accessible at `/admin` (role-based route guard: `admin` role required)
- [ ] Heatmap renders the stadium SVG with color intensity based on occupancy percentage per sector
- [ ] Match selector dropdown allows switching between upcoming matches
- [ ] Data fetched from `GET /api/admin/matches/:id/occupancy`
- [ ] Heatmap auto-refreshes every 60 seconds

**Story Points:** 5
**Priority:** 🟡 Medium
**Layer:** [FULL]
**Dependencies:** KTE-013, KTE-015

---

### KTE-062 – Admin Dashboard – Revenue Stats

**User Story:** As an admin, I want to see revenue statistics in the dashboard, so that I can track total sales and top-performing matches.

**Acceptance Criteria:**
- [ ] Revenue stats section shows: total revenue today, total revenue this month, top 3 matches by revenue
- [ ] Data fetched from `GET /api/admin/stats/revenue`
- [ ] Stats displayed as cards with trend indicators (vs. previous period)
- [ ] Endpoint protected by admin role
- [ ] Data is accurate to last completed payment (no pending payments counted)

**Story Points:** 3
**Priority:** 🟡 Medium
**Layer:** [FULL]
**Dependencies:** KTE-033, KTE-004

---

### KTE-063 – Admin Role & Role Guard

**User Story:** As a developer, I want an admin role system with backend guard and frontend route guard, so that admin-only endpoints and pages are protected from regular users.

**Acceptance Criteria:**
- [ ] `User.role` field with values `user` | `admin`
- [ ] `RolesGuard` NestJS guard checks role on protected admin endpoints
- [ ] Admin seed account created by database seeder
- [ ] Angular `AdminGuard` redirects non-admin users to home with a "Not Authorized" toast
- [ ] Role claim included in JWT payload

**Story Points:** 2
**Priority:** 🟡 Medium
**Layer:** [FULL]
**Dependencies:** KTE-026, KTE-031

---

---

## Post-POC Backlog Items (Future Iterations)

> These items are out of scope for the POC but should be addressed in later iterations.

---

### KTE-064 – Apple Wallet (.pkpass) Ticket Export

**User Story:** As a user, I want to add my e-ticket to Apple Wallet, so that I can access it quickly from my iPhone without opening the app.

**Story Points:** 5
**Priority:** 🟢 Low
**Layer:** [BACKEND]
**Dependencies:** KTE-038

---

### KTE-065 – Dynamic Pricing Engine

**User Story:** As an admin, I want ticket prices to increase automatically when less than 15% of seats are available, so that revenue is maximized for high-demand matches.

**Story Points:** 5
**Priority:** 🟢 Low
**Layer:** [BACKEND]
**Dependencies:** KTE-015, KTE-033

---

### KTE-066 – Two-Factor Authentication (2FA)

**User Story:** As a user, I want to enable 2FA on my account using an authenticator app, so that my account is protected from unauthorized access.

**Story Points:** 5
**Priority:** 🟢 Low
**Layer:** [BACKEND]
**Dependencies:** KTE-026

---

### KTE-067 – Google Pay / Apple Pay Checkout

**User Story:** As a user, I want to pay with Google Pay or Apple Pay, so that I can complete checkout faster without entering card details.

**Story Points:** 3
**Priority:** 🟢 Low
**Layer:** [FULL]
**Dependencies:** KTE-034

---

### KTE-068 – Match Check-in via QR Scan (Gate Module)

**User Story:** As a gate staff member, I want to scan a ticket QR code to validate entry, so that physical access control is integrated with the digital ticketing system.

**Story Points:** 5
**Priority:** 🟢 Low
**Layer:** [FULL]
**Dependencies:** KTE-042

---

## Completion Tracking

| Epic | Total Stories | Completed | Progress |
|---|---|---|---|
| E1 – Foundation | 7 | 7 | 100% |
| E2 – Landing Page | 5 | 5 | 100% |
| E3 – Stadium Map | 7 | 7 | 100% |
| E4 – Cart & Reservation | 5 | 5 | 100% |
| E5 – Auth & Profile | 7 | 7 | 100% |
| E6 – Checkout & Payment | 6 | 6 | 100% |
| E7 – E-ticket & Email | 5 | 5 | 100% |
| E8 – Loyalty System | 6 | 6 | 100% |
| E9 – Season Pass Loan | 6 | 6 | 100% |
| E10 – Advanced Features | 9 | 0 | 0% |
| Post-POC | 5 | 0 | 0% |
| **TOTAL** | **68** | **54** | **79%** |
