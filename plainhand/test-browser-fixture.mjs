// Explicit synthetic employer page for acceptance tests. Never used in the app.
import { chromium } from 'playwright';
import { ApplicationBrowser } from './jobs.mjs';

export function fixtureApplicationBrowser({ gated = false } = {}) {
  let page;
  const application = new ApplicationBrowser({ launch: async () => {
    const browser = await chromium.launch({ headless: true });
    const createContext = browser.newContext.bind(browser);
    browser.newContext = async config => {
      const context = await createContext(config);
      const createPage = context.newPage.bind(context);
      context.newPage = async () => {
        page = await createPage();
        await page.route('https://jobs.lever.co/**', route => {
          if (route.request().method() !== 'GET') return route.abort();
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Test Company — Graduate Engineer</title><style>body{font:16px/1.6 Arial;margin:40px auto;max-width:650px;color:#26392e;background:#f7f8f5}label{display:block;margin:20px 0}input,textarea,select{display:block;width:100%;padding:12px;box-sizing:border-box;border:1px solid #bdc9b4;background:white}input[type=checkbox]{width:auto;display:inline}button{background:#244c35;color:white;padding:12px 24px;border:0}</style></head><body><p>TEST FIXTURE · NOT A REAL EMPLOYER</p><h1>Graduate Engineer</h1><p>Test Company · Boston</p>${gated ? '<button type="button" id="start-application">Start application</button>' : ''}<form ${gated ? 'hidden' : ''}><label>Full name<input name="name"></label><label>Email<input name="email" type="email"></label><label>Resume<input name="resume" type="file" accept=".pdf"></label><label>Describe an engineering project.<textarea name="project"></textarea></label><label>Will you need sponsorship?<select name="sponsorship"><option value="">Choose an answer</option><option value="yes">Yes</option><option value="no">No</option></select></label><label><input type="checkbox" name="attestation">I attest that this application is accurate.</label><button type="submit">Submit application</button></form><script>if(document.querySelector("#start-application"))document.querySelector("#start-application").onclick=()=>{document.querySelector("form").hidden=false;document.querySelector("#start-application").remove()};window.submissionCount=0;document.querySelector('form').onsubmit=event=>{event.preventDefault();window.submissionCount++};</script></body></html>` });
        });
        return page;
      };
      return context;
    };
    return browser;
  } });
  return { application, get page() { return page; } };
}
