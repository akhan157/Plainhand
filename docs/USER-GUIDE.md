# Using Plainhand

A walkthrough from first start to a submitted application. Install first:
[INSTALL.md](INSTALL.md).

## The idea

Plainhand learns who you are from what you tell it and what you've written,
then does the repetitive parts of applying: tailoring documents, filling
forms, tracking follow-ups. It never claims more than you can back up, never
answers personal or legal questions for you, and never submits. You stay the
reviewer and the one who clicks submit.

You can do almost everything two ways: on the screens, or by telling the
assistant on **Home** ("save this job", "make the cover letter shorter",
"what's due this week?"). When the assistant wants to change something it
shows the change and waits for you to confirm.

## 1. Connect your AI account

**Connections** shows each AI account with three steps: install, sign in,
check it works. You only need one. Finish its steps and press **Check and use**. Plainhand uses your plan through that tool; it shows
calls and token use under **AI usage**.

## 2. Build your profile

**Profile & brain** walks you through five steps in order. The next one opens
on its own and finished ones fold away:

1. **Your basics and resume:** name, contact details, location, target roles,
   and your resume (upload a PDF or paste the text). Work authorization and
   compensation are optional and only ever used where you say.
2. **Your resume format** (optional): see section 3. You can skip it and come
   back later.
3. **Tell your story:** describe projects, jobs and results in your own words.
   Plainhand asks one question at a time and saves what you say exactly as you
   said it. Three or more statements complete the step.
4. **Check how Plainhand sees you:** Plainhand sums up your strengths and voice.
   Approve it only if it's right; otherwise keep talking and rebuild it.
5. **Approve your standard application:** see section 4.

After you start talking, **Keep improving** shows profile strength and where
you draw the line.

## 3. Set your resume format

Under **Your resume format**, choose **Read format from my resume PDF** and
pick a PDF of your current resume. Plainhand reads its page size, margins,
fonts and sizes, heading style and names, section order, where dates go and
your bullet style, and shows a preview. Adjust anything that's off and press
**Save format**. Every resume and cover letter is rendered in it from then on.
Only the format is kept, not your resume's text. Use a text PDF exported from
Word or Google Docs, not a scan.

## 4. Approve your standard application

**Your standard application** is one resume and one cover letter (with
{company} and {role} slots) that every application starts from. Have Plainhand
write it, read it, ask for changes in plain words ("lead with the chassis
project", "keep the letter under 200 words"), and press **Use this as my
standard**. If your profile changes later, it tells you to rewrite it.

## 5. Find and evaluate roles

On **Jobs**, add a role by its link. Company career pages and Greenhouse,
Lever, Ashby, Workday, Workable, SmartRecruiters and similar sites all work.
From **LinkedIn, Indeed or another job board**, paste the description too:
Plainhand doesn't open those sites. When you apply, give it the employer's own
application link (most postings have one).

**Evaluate** checks the posting is live and scores your fit (out of 5) with
the evidence for each match and the gaps. **Campaigns** can check company
boards on a schedule while Plainhand is open and surface new roles.

## 6. Prepare and review an application

Choose a role and **Prepare application**. Plainhand tailors your standard for
the role, has a separate reviewer check every claim against your sources, and
renders PDFs. In the **Packet** tab:

- **How strongly this describes you** grades each claim: *undersold* (you can
  say more), *balanced*, *stretched* (stronger than your evidence) or
  *unsupported*. Choose **Use suggested wording** or **Keep mine**; your
  choices teach Plainhand where you draw the line (see **Where you draw the
  line** on your profile). Unsupported claims can never be kept. Stock
  phrases are flagged as generic.
- **Humanizer pass** shows how many parts were rewritten to remove AI
  writing patterns. Every draft goes through it before the fact check; a
  rewrite that would change a number keeps your original line.
- **Ask for a change** revises just what you asked.
- Approve the packet once you've read it. Any later change clears the
  approval.

**Applications → Work through your queue** steps through several packets in
a row.

## 7. Apply

In the **Apply** tab of an approved application:

1. **Open & inspect application** opens the employer's form in a separate
   browser on your screen.
2. **What Plainhand will fill** lists every field: filled (and from what),
   or left for you with the reason (personal or legal, not in your profile,
   a document, a choice).
3. **Autofill to final review** fills standard fields, uploads your approved
   resume and cover letter, and continues through form steps. It stops at
   sign-in pages and security checks (**Handle sign-in or verification**, then
   **Resume inspection**), at questions it can't answer, and always before the
   final submit.
4. **Before you submit** shows what's filled, what still needs you, and
   anything the page didn't keep. Answers you type can be saved for next time
   (you approve them under **Workspace**).
5. **Take over the browser**, check everything on the page, and submit it
   yourself. Back in Plainhand, press **I submitted this application**.

## 8. After applying

The **Record** tab tracks contacts, interviews and the next action.
Plainhand drafts follow-ups from what you actually submitted; you send them and
mark them sent. **Insights** shows which kinds of roles lead to interviews once
there's enough data, and suggests changes for you to accept or reject.

## Settings worth knowing

- **Workspace → How much Plainhand does on its own:** by default it asks per
  application. You can let it prepare strong matches on its own (fit 4/5 or
  more, from your approved standard, up to a daily limit). It still never
  submits.
- **Workspace → What your agent sees:** turn off any source or profile field
  you'd rather not send to the AI provider.
- **Workspace → Export workspace:** a backup you can import elsewhere.

## Talking to it by voice

Any dictation app works. [Handy](https://handy.computer) is free, offline and
push-to-talk: hold the key, speak, and the text lands in the message box.

## Where your data is

| What | Where |
| --- | --- |
| Profile, conversation, applications, settings | `data/plainhand/workspace.json` |
| Identity and targets | `config/profile.yml` |
| Resume text | `cv.md` |
| Generated PDFs and packets | `output/` |
| Tracker | `data/applications.md` |
| Evaluation reports | `reports/` |

None of these are part of the Plainhand code, and updates don't change them.
