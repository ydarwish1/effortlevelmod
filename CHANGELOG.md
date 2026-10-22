# Changelog

## 0.2.0 (2026-10-22)

- Haiku now rates each task you send, with a reason of about ten words, shown on a second line above the prompt. The old word rules rated 18 of 25 test tasks `high`; the new rating got 25 of 25 within the expected range, and 15 of 15 on a second set of tasks.
- "Yes, do it" is rated as the work it approves: the rating sees the end of Claude's last reply.
- The project baseline is gone. It made almost every real project `high`, and a big project does not make a small task bigger.
- The word rules stay as a backup when the Haiku call fails, and the reason then says `word rules:`.
- Your prompt never waits for the rating. Each rating is one Haiku call of about 1,050 tokens in and 40 out.

## 0.1.0 (2026-10-22)

- First release: a project baseline from the file list, a rating for each prompt, the running level from each request, the line above the prompt, and `/effortlevel [task]`.
- Advice only: the mod never changes the effort level.
- Tested on Claude Code 2.1.308.
