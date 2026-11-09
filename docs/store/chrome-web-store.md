# Store listing: Plainhand extension

Upload `dist/plainhand-extension-<version>.zip` (`npm run package:extension`).
Images: `npm run store:extension-assets` → `dist/store/screenshot-1.png` (1280×800),
`dist/store/promo-small.png` (440×280). Icon: `extension/icons/icon-128.png`.
The same zip is accepted by Microsoft Edge Add-ons.

## Store listing tab

- **Name:** Plainhand
- **Summary (≤132):** Save jobs to Plainhand, fill application pages with your approved answers, and record what you submitted. It never submits for you.
- **Category:** Productivity → Tools (Chrome) / Productivity (Edge)
- **Language:** English
- **Homepage:** https://plainhand-cloud.vercel.app
- **Support:** https://plainhand-cloud.vercel.app/support

**Description:**

> Plainhand helps you apply for jobs without retyping the same answers on every site.
>
> • Save this job: one click saves the company, role, link and posting to your Plainhand workspace.
> • Fill this page: on an application form, Plainhand fills the fields it has answers for, using the resume, cover letter and answers you already reviewed and approved in Plainhand. It attaches your approved resume and cover letter files.
> • You stay in charge: sensitive questions (work authorization, salary, demographics, legal consent) are left for you. Plainhand never presses Submit. You check the form and submit it yourself.
> • I submitted this: one click records the application in your tracker.
>
> Works with common application systems such as Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable and Recruitee. Requires a free Plainhand account.

## Privacy practices tab

- **Single purpose:** Fill job application forms with answers the user approved in their Plainhand account, save job postings to that account, and record submitted applications.
- **activeTab:** Reads the current page only after the user clicks Save this job or Fill this page in the popup.
- **scripting:** Injects the form-filling script into the current tab (and its embedded application frame) when the user clicks Fill this page.
- **storage:** Keeps the user's Plainhand sign-in and site setting in extension storage.
- **identity:** Signs the user in to their Plainhand account with OAuth (`chrome.identity.launchWebAuthFlow`); no Google account data is read.
- **Optional host permissions (application sites):** Requested at the moment of use, only when the form is embedded from an application system's domain that activeTab cannot reach.
- **Remote code:** No. All code ships in the package.
- **Data collected:** Website content (job posting text, form field labels and choices, page address) and authentication information (Plainhand sign-in token), only on the user's click, sent only to the user's own Plainhand workspace.
- **Certify:** not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.
- **Privacy policy URL:** https://plainhand-cloud.vercel.app/privacy

## After approval

Copy the extension ID from the dashboard (and Edge's, which differs) into the Vercel
environment variable `PLAINHAND_EXTENSION_IDS` (comma separated) and redeploy, so
only the published extension can use the extension API.
