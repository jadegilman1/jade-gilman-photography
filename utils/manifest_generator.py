import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_IMAGES = ROOT / "public" / "images"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def generate_manifest(directory: Path) -> None:
    """Generate manifest.json for each gallery subfolder (non-recursive)."""
    for entry in sorted(os.listdir(directory)):
        subdir_path = directory / entry
        if not subdir_path.is_dir():
            continue
        images = sorted(
            f for f in os.listdir(subdir_path)
            if os.path.isfile(subdir_path / f) and Path(f).suffix.lower() in IMAGE_EXTS
        )
        manifest_path = subdir_path / "manifest.json"
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(images, f, indent=4, ensure_ascii=False)
        print(f"Generated {manifest_path}")


if __name__ == "__main__":
    generate_manifest(PUBLIC_IMAGES)