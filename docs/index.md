---
layout: home
hero:
  name: Ryte
  text: Type-safe workflow engine for TypeScript
  tagline: Define states with Zod. Route commands through middleware. Ship with confidence.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/
features:
  - title: Type-Safe by Default
    details: Zod schemas define your states, commands, events, and errors. TypeScript infers everything — no manual type annotations needed.
  - title: Middleware Pipelines
    details: Koa-style onion model with global, state-scoped, and inline middleware. Add auth, logging, or validation without touching handlers.
  - title: Zero Platform Lock-in
    details: Pure logic with no runtime dependencies beyond Zod. Works on Node.js, Bun, and Deno.
---
