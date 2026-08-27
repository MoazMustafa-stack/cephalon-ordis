# Operations

## Windows

The root Compose file has explicit `E:/Cephalon-Ordis` bind mounts. Run [backup.ps1](../scripts/backup.ps1) to stage timestamped PostgreSQL and artifact backups in `D:\Ordis-Backups`. Speech models stay under `E:\Cephalon-Ordis\data\models`.

## Arch

Create the `ordis` service account and `/srv/cephalon-ordis/{code,data,config}`, copy the repository into `code`, and install the units from `deploy/arch/systemd`. The Arch Compose file binds persistent data beneath `/srv/cephalon-ordis/data`.

Use Tailscale Serve or a private reverse proxy bound only to the node's Tailscale address. Do not open coordinator or PostgreSQL ports on a public interface.

## Backup/restore checks

Keep backups off the project SSD. Test restoration into a disposable database on a schedule. Hash report artifacts and keep their hashes with the report evidence.

