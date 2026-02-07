"""Generate thumbnails for all gallery images.

Creates a `thumbs/` subdirectory inside each gallery folder with
~400 px-wide JPEG thumbnails at quality 75.  These are used for
cover previews and gallery grid views; the originals are served
only inside the lightbox.
"""

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from PIL import Image
from tqdm import tqdm

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_IMAGES = ROOT / "public" / "images"
THUMB_WIDTH = 400
THUMB_QUALITY = 75
MAX_WORKERS = os.cpu_count() or 4
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

ResamplingAttr = getattr(Image, "Resampling", None)
if ResamplingAttr:
    RESAMPLE: Any = getattr(
        ResamplingAttr, "LANCZOS",
        getattr(ResamplingAttr, "BICUBIC", getattr(ResamplingAttr, "NEAREST", 1)),
    )
else:
    RESAMPLE: Any = getattr(
        Image, "LANCZOS", getattr(Image, "BICUBIC", getattr(Image, "NEAREST", 1))
    )


def _make_thumb(src: Path, dst: Path) -> None:
    """Resize *src* to at most THUMB_WIDTH px wide and save to *dst*."""
    try:
        with Image.open(src) as img:
            if img.width <= THUMB_WIDTH:
                # Already small enough – just optimise
                img.save(dst, "JPEG", quality=THUMB_QUALITY, optimize=True)
                return
            ratio = THUMB_WIDTH / img.width
            new_h = int(img.height * ratio)
            thumb = img.resize((THUMB_WIDTH, new_h), RESAMPLE)
            thumb.save(dst, "JPEG", quality=THUMB_QUALITY, optimize=True)
    except (OSError, Image.DecompressionBombError) as exc:
        print(f"  Warning: could not thumbnail {src.name}: {exc}")


def generate_thumbs(gallery_dir: Path, *, force: bool = False) -> int:
    """Create thumbnails for every image in *gallery_dir*.

    Returns the number of thumbnails written.
    """
    thumbs_dir = gallery_dir / "thumbs"
    thumbs_dir.mkdir(exist_ok=True)

    sources = [
        gallery_dir / f
        for f in sorted(os.listdir(gallery_dir))
        if (gallery_dir / f).is_file() and Path(f).suffix.lower() in IMAGE_EXTS
    ]
    if not sources:
        return 0

    # Skip files that already have an up-to-date thumbnail
    if not force:
        sources = [
            s for s in sources
            if not (thumbs_dir / s.name).exists()
            or (thumbs_dir / s.name).stat().st_mtime < s.stat().st_mtime
        ]
    if not sources:
        return 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {
            pool.submit(_make_thumb, s, thumbs_dir / s.name): s
            for s in sources
        }
        for fut in tqdm(
            as_completed(futures),
            total=len(futures),
            desc=f"  {gallery_dir.name}",
            unit="img",
        ):
            fut.result()

    return len(sources)


def generate_all_thumbs(*, force: bool = False) -> None:
    """Walk every gallery folder under public/images and create thumbnails."""
    dirs = sorted(
        d for d in os.listdir(PUBLIC_IMAGES)
        if (PUBLIC_IMAGES / d).is_dir() and d != "thumbs"
    )
    if not dirs:
        print("No gallery directories found.")
        return

    total = 0
    for name in dirs:
        gallery_dir = PUBLIC_IMAGES / name
        count = generate_thumbs(gallery_dir, force=force)
        if count:
            total += count
        else:
            print(f"  {name}: thumbnails up to date")
    print(f"\nDone – generated {total} thumbnails across {len(dirs)} galleries.")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate gallery thumbnails")
    parser.add_argument(
        "--force", action="store_true",
        help="Regenerate all thumbnails even if they already exist",
    )
    args = parser.parse_args()
    generate_all_thumbs(force=args.force)
