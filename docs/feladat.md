You are an experienced Product Owner with 15 years of experience in agile software 
development. You create detailed, developer-ready backlogs with clear acceptance 
criteria, priority levels, and story points.

Use 0% initially.

The backlog should reflect this application description from `/docs/application.md`:

- This is the KTE Jegyportál — the official ticketing and season pass management 
  platform for Kecskeméti TE (KTE), a Hungarian football club.
- The application allows fans to visually purchase tickets on a 2.5D isometric 
  SVG stadium map, manage season passes, and loan their passes to other users.
- Authors can manage their profile, loyalty points, and ticket history through 
  an intuitive user interface.

- POC scope:
  - A public landing page with a hero section, countdown timer to the next match, 
    and static match schedule (mocked data)
  - A 2.5D isometric SVG stadium map where users can browse sectors and select 
    individual seats (color-coded: free / occupied / VIP / accessible)
  - A seat detail panel showing price, category, and row/seat number
  - An accessibility toggle that grays out all non-accessible seats
  - A shopping cart with a 5-minute seat reservation timer
  - A checkout flow with simulated Stripe payment (test mode)
  - QR-code based e-ticket generation after successful payment
  - E-ticket delivery via email (Nodemailer)
  - User registration and login (JWT-based)
  - A user profile page showing active tickets, purchase history, and loyalty points
  - A loyalty points dashboard showing current tier (Lila/Ezüst/Arany/KTE Legenda) 
    and points breakdown
  - A season pass loan flow: a pass holder can loan their seat for a specific match 
    to another registered user via QR code
  - A waitlist system: when a match is sold out, users can join the waitlist and 
    receive an email notification with a 10-minute claim window when a seat opens
  - A floating AI chatbot widget (Claude API) that answers questions about matches, 
    tickets, loyalty points, and stadium info
  - A weather warning banner on the checkout page if rain is forecast for uncovered 
    sectors (OpenWeatherMap API)
  - An admin dashboard showing real-time seat occupancy heatmap and revenue stats

- Tech stack:
  - Frontend: Angular 17+ (standalone components, TypeScript strict)
  - Backend: NestJS (TypeScript, modular)
  - Database: MySQL 8+ with TypeORM
  - Cache: Redis (seat locking, waitlist timers, rate limiting)
  - Payments: Stripe API
  - AI: Anthropic Claude API
  - Weather: OpenWeatherMap API

Important scoping notes:

- The initial backlog must prioritize only what is needed for the POC.
- Features like Apple Wallet (.pkpass), dynamic pricing, and 2FA are real features 
  but should appear as later backlog items outside the POC core flow.
- Do not let non-POC features dominate the early iterations.
- Each backlog item must be small enough to be completed in 1–2 days by one developer.
- Group items into Epics, then break each Epic into User Stories.
- Every User Story must have:
    - A unique ID (e.g., KTE-001)
    - A user story sentence: "As a [role], I want [feature] so that [benefit]."
    - Acceptance criteria (bullet list, testable)
    - Story points (Fibonacci: 1, 2, 3, 5, 8)
    - Priority: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low
    - Layer tag: [FRONTEND] / [BACKEND] / [FULL] / [DB]
    - Dependencies (other KTE-XXX IDs if applicable)

Return the completed `/docs/backlog.md` content only.