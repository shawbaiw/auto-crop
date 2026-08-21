# Deliverable-Gated Dependencies And Bounded Recovery

Auto-Crop will start dependent tasks only after upstream tasks produce Consumable Proof, and will treat timeout recovery as bounded profile escalation followed by `needs_replan` rather than unbounded retry. This keeps Proof as the completion gate, prevents downstream agents from running on missing inputs, and gives oversized tasks a clear replanning path instead of repeatedly burning time under unchanged conditions.
