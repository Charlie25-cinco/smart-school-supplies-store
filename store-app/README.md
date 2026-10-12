# Local POS and inventory application

Laravel 13, Blade, Vite, and SQLite. See [the project README](../README.md) for installation, private staff-account creation, local server commands, verification, and catalog publishing instructions.

This is operational documentation, not a claim of full ISO/IEC/IEEE 29148 compliance. The simplified requirements baseline and traceability are in [docs/REQUIREMENTS.md](../docs/REQUIREMENTS.md).

From this directory, the verification commands are:

```powershell
composer test
php vendor/bin/pint --test
npm.cmd run build
npm.cmd run test:ui
```

The POS database remains local. Public hosting applies only to the sibling `catalog/` folder; staff accounts, sales records, `.env`, and SQLite files must stay outside public artifacts.
