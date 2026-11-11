# 工厂营运台 (Factory Desk)

One page that runs a make-and-sell product business: orders, customer
service, stock, payments, marketing and approvals. Published as a Claude
artifact; data lives in the artifact's shared database.

    part1.html   page shell and styles
    part2.js     state, storage, house rules (pricing, claim check, flags), derived figures
    part3.js     the ten views
    part4.js     forms, actions, AI calls, start-up
    build.sh     joins the parts into app.html (the file that is published)
    test/walkthrough.cjs   drives the whole flow in a browser against a stand-in database

Build and test:

    ./build.sh && node test/walkthrough.cjs      # expects "ERRORS: none"

## Who can do what

| Collection | Read | Write |
|---|---|---|
| orders, inbox, stock, batches, approvals | anyone the page is shared with | contributors |
| products, faq, decisions, settings | anyone the page is shared with | owner / editors |
| costs | owner / editors | owner / editors |

`decisions` is the approval gate: a reply or a piece of marketing copy only
becomes "ready to send" when an owner writes the approved text there.

## The agents

Eleven run on rules (no model, no cost): morning brief, answer matcher,
pricing, shipping gate, stock watch, collections, batches and expiry,
customer records, claim check, trademark and compliance, approval gate.
Two use a model, only when someone taps: reply drafter and translator,
copywriter. Everything they write passes the claim check and the owner.

Not connected yet: WhatsApp send/receive, online-store order sync, ad
performance, bank or courier reconciliation, scheduled reports. Messages
are pasted in and sent with one tap; the app works while it is open.

## Rules worth knowing

- Stock changes only through a batch, a stock count, a shipment or a
  restocked return, each under a short lease so two people cannot overwrite
  each other.
- Nothing is deleted. Products and answers are switched off; orders are
  cancelled or returned.
- Product names that contain another company's trademark, and products in
  regulated categories, are flagged. The flags say "confirm with the local
  regulator"; they are prompts to check, not legal advice.
