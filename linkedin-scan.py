#!/usr/bin/env python3
"""
linkedin-scan.py — LinkedIn job scanner (zero-auth, public pages)

Hits LinkedIn's public guest job-search endpoint
(linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search) — no login,
no LinkedIn account needed, no ban risk for the user.

Reads search config from portals.yml (linkedin_search section).
Writes results in the same TSV format as batch/scan-results-*.tsv so
they integrate with the existing review-then-merge workflow.

Setup:
    pip install requests beautifulsoup4 pyyaml

Usage:
    python linkedin-scan.py                     # scan with portals.yml config
    python linkedin-scan.py --dry-run           # preview without writing
    python linkedin-scan.py --location "Brooklyn, NY"  # override location
    python linkedin-scan.py --term "mechanical engineer"  # single term

Output:
    batch/scan-results-linkedin.tsv  (review, then merge URLs into pipeline.md manually)
"""

import argparse
import csv
import sys
import time
from pathlib import Path
from urllib.parse import quote_plus

try:
    import yaml
except ImportError:
    sys.exit("error: pyyaml not installed. run: pip install pyyaml")

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("error: requests/beautifulsoup4 not installed. run: pip install requests beautifulsoup4")


PORTALS_PATH = Path("portals.yml")
SCAN_HISTORY_PATH = Path("data/scan-history.tsv")
OUTPUT_PATH = Path("batch/scan-results-linkedin.tsv")

GUEST_API = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

F_TIME = {
    24: "r86400",
    72: "r259200",
    168: "r604800",
    336: "r1209600",
    720: "r2592000",
}


def load_portals(required=True):
    if not PORTALS_PATH.exists():
        if required:
            sys.exit(f"error: {PORTALS_PATH} not found. copy from templates/portals.example.yml first.")
        return {}
    with open(PORTALS_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_seen_urls():
    if not SCAN_HISTORY_PATH.exists():
        return set()
    seen = set()
    with open(SCAN_HISTORY_PATH, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            url = row.get("url", "").strip().split("?")[0]
            if url:
                seen.add(url)
    return seen


def title_passes(title, positives, negatives):
    if not title:
        return False
    t = title.lower()
    has_pos = any(p.lower() in t for p in positives) if positives else True
    has_neg = any(n.lower() in t for n in negatives) if negatives else False
    return has_pos and not has_neg


def closest_time_filter(hours_old):
    if not hours_old:
        return None
    for h in sorted(F_TIME.keys()):
        if hours_old <= h:
            return F_TIME[h]
    return F_TIME[max(F_TIME.keys())]


def fetch_page(term, location, f_tpr, f_wt, start):
    params = {
        "keywords": term,
        "location": location,
        "start": start,
    }
    if f_tpr:
        params["f_TPR"] = f_tpr
    if f_wt:
        params["f_WT"] = f_wt
    try:
        r = requests.get(GUEST_API, params=params, headers=HEADERS, timeout=20)
        if r.status_code == 429:
            print("    rate-limited (429), backing off 30s...")
            time.sleep(30)
            return fetch_page(term, location, f_tpr, f_wt, start)
        if r.status_code != 200:
            print(f"    HTTP {r.status_code}, skipping page")
            return None
        return r.text
    except requests.RequestException as e:
        print(f"    request error: {e}")
        return None


def parse_cards(html):
    soup = BeautifulSoup(html, "html.parser")
    cards = soup.find_all("li") or soup.find_all("div", class_="base-card")
    rows = []
    for card in cards:
        title_tag = card.find(class_="base-search-card__title")
        company_tag = card.find(class_="base-search-card__subtitle")
        loc_tag = card.find(class_="job-search-card__location")
        time_tag = card.find("time")
        link_tag = card.find("a", class_="base-card__full-link") or card.find("a", href=True)

        if not (title_tag and link_tag):
            continue
        title = title_tag.get_text(strip=True)
        company = company_tag.get_text(strip=True) if company_tag else ""
        loc = loc_tag.get_text(strip=True) if loc_tag else ""
        href = link_tag.get("href", "").split("?")[0]
        posted = time_tag.get("datetime", "") if time_tag else ""

        if href:
            rows.append({
                "title": title,
                "company": company,
                "location": loc,
                "url": href,
                "posted_date": posted,
            })
    return rows


def scan_term(term, location, f_tpr, f_wt, results_wanted):
    """Paginate through guest API in batches of 25 until results_wanted reached."""
    out = []
    start = 0
    while len(out) < results_wanted:
        html = fetch_page(term, location, f_tpr, f_wt, start)
        if not html:
            break
        page_rows = parse_cards(html)
        if not page_rows:
            break
        out.extend(page_rows)
        start += 25
        time.sleep(1)
        if len(page_rows) < 25:
            break
    return out[:results_wanted]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--location")
    parser.add_argument("--term", help="run a single search term (overrides portals.yml)")
    parser.add_argument("--hours-old", type=int)
    parser.add_argument("--results", type=int)
    args = parser.parse_args()

    portals = load_portals(required=not args.term)
    cfg = portals.get("linkedin_search", {}) or {}

    if not cfg.get("enabled", True):
        print("linkedin_search disabled in portals.yml. skipping.")
        return

    title_filter = portals.get("title_filter", {}) or {}
    positives = title_filter.get("positive", []) or []
    negatives = title_filter.get("negative", []) or []

    if args.term:
        search_terms = [args.term]
    else:
        search_terms = cfg.get("search_terms") or positives
    if not search_terms:
        sys.exit("error: no search terms. set linkedin_search.search_terms or title_filter.positive in portals.yml")

    location = args.location or cfg.get("location", "United States")
    hours_old = args.hours_old or cfg.get("hours_old", 168)
    results_wanted = args.results or cfg.get("results_wanted", 25)
    remote_only = cfg.get("remote", False)

    f_tpr = closest_time_filter(hours_old)
    f_wt = "2" if remote_only else None

    print(f"linkedin scan: {len(search_terms)} term(s), location='{location}', hours_old~={hours_old}, results~={results_wanted}/term")

    seen = load_seen_urls()
    print(f"loaded {len(seen)} URLs from scan-history.tsv (will dedup)")

    all_rows = []
    rank = 1
    for term in search_terms:
        print(f"  searching: '{term}'...")
        try:
            jobs = scan_term(term, location, f_tpr, f_wt, results_wanted)
        except Exception as e:
            print(f"    skipped (error: {e})")
            continue

        kept = 0
        for job in jobs:
            url = job["url"]
            if not url or url in seen:
                continue
            if not title_passes(job["title"], positives, negatives):
                continue
            seen.add(url)
            all_rows.append({
                "rank": rank,
                "title": job["title"],
                "agency": job["company"],
                "location": job["location"],
                "hiring_path": "Private",
                "posted_date": job["posted_date"],
                "deadline": "Open until filled",
                "url": url,
                "notes": f"LinkedIn match for query '{term}'",
            })
            rank += 1
            kept += 1
        print(f"    kept {kept} (after title filter + dedup)")

    print(f"\ntotal new: {len(all_rows)}")

    if args.dry_run:
        print("dry-run — not writing.")
        for row in all_rows[:10]:
            print(f"  [{row['rank']}] {row['title']} @ {row['agency']} ({row['location']}) - {row['url']}")
        if len(all_rows) > 10:
            print(f"  ... and {len(all_rows) - 10} more")
        return

    if not all_rows:
        print("no new jobs to write.")
        return

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8", newline="") as f:
        fieldnames = ["rank", "title", "agency", "location", "hiring_path", "posted_date", "deadline", "url", "notes"]
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter="\t")
        writer.writeheader()
        for row in all_rows:
            writer.writerow(row)
    print(f"wrote {len(all_rows)} rows to {OUTPUT_PATH}")
    print(f"\nnext: review {OUTPUT_PATH}, then merge urls into data/pipeline.md as needed.")


if __name__ == "__main__":
    main()
