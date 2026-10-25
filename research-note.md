# A harness should earn its complexity

A coding agent's harness includes the tools, permissions, instructions and
feedback surrounding its model. My position is that additional harness
complexity should address a demonstrated failure and justify its continuing
cost. A separate planner or longer rulebook is not automatically better
engineering. The question is whether a control makes accepted work more
reliable without consuming disproportionate human attention. This argument
favours selective constraints, rather than minimalism regardless of risk.

Schluntz and Zhang's [Building effective agents](https://www.anthropic.com/research/building-effective-agents)
(2024) recommends starting with simple solutions and adding complexity when
needed, explicitly recognising a trade-off between performance, latency and
cost. This is useful advice, but comes from practitioner experience rather
than a controlled comparison of architectures. It cannot establish that
one agent is generally superior. Its stronger implication is methodological:
developers should explain which failure requires orchestration and what
improvement would justify it. A planner can be valuable when its output
changes a decision; generating another document is a weak success criterion.

Yang et al.'s [SWE-agent](https://proceedings.neurips.cc/paper_files/paper/2024/file/5a7c947568c1b1328ccc5230172e1e7c-Paper-Conference.pdf)
(2024) provides firmer evidence that environment design matters. Its
experiments compare agent-computer interfaces, including repository
navigation, editing and feedback. Ablations show that interface choices
affect issue-resolution performance. This supports investing in actionable
feedback rather than treating the model as the only component worth
improving. However, resolving benchmark issues is narrower than delivering
a useful application. A passing patch does not show that a newcomer
understands a page. Harness evaluation therefore needs both executable
checks and observations appropriate to the product.

Instruction design introduces another limit. Liu et al.'s
[Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/)
(2024) finds that performance on question-answering and retrieval tasks
depends on where relevant information appears in long contexts. These
experiments concern specific models and tasks; they do not prove that a
long coding guide will fail, or that every current model shares the same
weakness. They nevertheless challenge the assumption that available context
is uniformly usable. My inference is to organise guidance around a short
entry point and relevant supporting documents, then check whether important
constraints survive actual work.

There is also a substantial case for more structure. In
[Harness engineering](https://openai.com/index/harness-engineering/),
Lopopolo (2026) describes an agent-built product supported by repository
knowledge, mechanical architecture checks and observability. This suggests
that clear boundaries can make autonomy practical. Yet the same report
rejects an oversized instruction file in favour of indexed documentation.
The apparent disagreement with simplicity is therefore smaller than it
first seems: complex systems may need extensive infrastructure while still
offering agents focused context. As a company case study, the report does
not isolate which controls caused its reported benefits or establish that
a small project needs the same machinery.

My discountShow designer trial illustrates the distinction. Handover,
re-reading and planning made replies noticeably slower; I
[removed the workflow](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/3ae14b5)
before a plan completed a feature cycle. That is a local usability judgement,
not a controlled finding against multi-agent systems. The useful research
question is which changes benefit from an extra design pass. A security
boundary or data migration may justify review costs that a wording change
does not. Role separation alone also does not establish independent
verification: the reviewer must inspect evidence, not simply endorse the
builder's explanation.

Controls also need different standards of success. A permission check can
reject an unauthorised deletion, but cannot decide whether a feature was
worth building. Treating both as automated gates hides the latter judgement.
I would keep safety and data-integrity constraints mandatory, while assessing
optional planning steps against their observed value. Tests also need scrutiny:
an incorrect assertion should be corrected with evidence, rather than
preserved simply because it already belongs to the harness. Each control
needs a clear reason to stay when the project changes.

To evaluate that claim, I would compare workflows on matched tasks using
the same model, repository baseline and tool access. Outcomes should include
valid completion, regressions, elapsed time, token cost and human review
effort, with repeated trials and stated acceptance criteria. Product-facing
tasks also need user observations. I have not performed that experiment.
The practical standard I propose is to retain a control when its benefit
can be identified, revise it when evidence is ambiguous, and remove it when
its overhead repeatedly outweighs its value. A harness should preserve
the developer's ability to question results, not make acceptance a formality.

## References

- Schluntz, E., and Zhang, B. 2024. [Building effective agents](https://www.anthropic.com/research/building-effective-agents). Anthropic, 19 December.
- Yang, J., Jimenez, C. E., et al. 2024. [SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering](https://proceedings.neurips.cc/paper_files/paper/2024/file/5a7c947568c1b1328ccc5230172e1e7c-Paper-Conference.pdf). Advances in Neural Information Processing Systems 37.
- Liu, N. F., et al. 2024. [Lost in the Middle: How Language Models Use Long Contexts](https://aclanthology.org/2024.tacl-1.9/). TACL 12, 157–173.
- Lopopolo, R. 2026. [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/). OpenAI.
