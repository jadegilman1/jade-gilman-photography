import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run_script(script_path: Path) -> None:
    if not script_path.exists():
        print(f"{script_path} not found.")
        return
    try:
        subprocess.run(
            [sys.executable, str(script_path)],
            check=True,
            cwd=str(ROOT),
        )
        print(f"{script_path.name} ran successfully.")
    except subprocess.CalledProcessError as e:
        print(f"Error running {script_path.name}:\n{e}")


if __name__ == "__main__":
    idiot_check = input(
        "Please confirm you have uploaded the full resolution gallery to the "
        "file hosting site (github) prior to running this script.\n"
        "Your images are about to be irreversibly compressed for website hosting. (yes/no): "
    )
    if idiot_check.lower() != "yes":
        print("Make good decisions.")
        exit()

    scripts = [
        ROOT / "utils" / "img_resizer.py",
        ROOT / "utils" / "manifest_generator.py",
        ROOT / "utils" / "gallery_generator.py",
        ROOT / "utils" / "secrets_setter.py",
    ]

    for script in scripts:
        run_script(script)

    print("All scripts executed. Move on to the next set of instructions!")