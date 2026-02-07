import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from PIL import Image
from tqdm import tqdm

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_IMAGES = ROOT / "public" / "images"
RESIZE_TARGET = (1600, 1200)
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


def _resize_one(file_path: Path) -> None:
    with Image.open(file_path) as img:
        if img.width <= RESIZE_TARGET[0] and img.height <= RESIZE_TARGET[1]:
            return
        img.thumbnail(RESIZE_TARGET, RESAMPLE)
        img.save(file_path, quality=85, optimize=True)


def resize_images(directory: Path) -> None:
    files_to_resize = [
        directory / f
        for f in os.listdir(directory)
        if os.path.isfile(directory / f) and Path(f).suffix.lower() in IMAGE_EXTS
    ]
    if not files_to_resize:
        print("No images found to resize.")
        return

    print(f"\nResizing {len(files_to_resize)} images ({MAX_WORKERS} threads)…")
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_resize_one, p): p for p in files_to_resize}
        for fut in tqdm(as_completed(futures), total=len(futures), desc="Resizing", unit="file"):
            fut.result()


if __name__ == "__main__":
    directories = sorted(
        d for d in os.listdir(PUBLIC_IMAGES)
        if (PUBLIC_IMAGES / d).is_dir()
    )
    if not directories:
        print("No directories found.")
    else:
        print("Available directories:")
        for i, d in enumerate(directories, start=1):
            print(f"{i}. {d}")

        while True:
            choice = input("Enter the number of the directory you want to resize: ").strip()
            if not choice.isdigit():
                print("Please enter a valid number.")
                continue
            idx = int(choice)
            if 1 <= idx <= len(directories):
                chosen_directory = directories[idx - 1]
                break
            else:
                print(f"Please enter a number between 1 and {len(directories)}.")

        resize_images(PUBLIC_IMAGES / chosen_directory)
