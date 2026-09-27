# Job Application Tracker

A lightweight, no-install job application tracker. Open `index.html` in any modern browser and start tracking — no server, build step, or account required.

## Features

- **Kanban board** with columns for Wishlist → Applied → Screening → Interviewing → Offer → Rejected / Withdrawn. Drag cards between columns to update status.
- **Table view** with sorting (newest, oldest, company, follow-up date, recently updated).
- **Search & filter** across company, role, location, contact, source, and notes.
- **Rich details** per application: company, role, status, date applied, location, salary, posting URL, source, contact, next follow-up date, priority, and notes.
- **Follow-up reminders** — a banner lists follow-ups that are overdue or due within 3 days.
- **Stats** — total, active, interviewing, offers, applied this week, and response rate.
- **Status history** — each status change is timestamped (included in JSON backups).
- **Export CSV** for spreadsheets, **Backup / Import JSON** to move data between browsers or machines.
- Light / dark theme, mobile-friendly layout.

## Usage

```sh
# Just open the file…
open index.html            # macOS
xdg-open index.html        # Linux

# …or serve it locally
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Data storage

All data is saved in your browser's `localStorage` — it never leaves your machine. Because of that, clearing site data or switching browsers will lose it, so use **Backup JSON** periodically and **Import JSON** to restore.
