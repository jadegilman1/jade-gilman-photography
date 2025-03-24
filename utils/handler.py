import subprocess

def run_script(script_path):
    try:
        subprocess.run(["python", script_path], check=True)
        print(f"{script_path} ran successfully.")
    except subprocess.CalledProcessError as e:
        print(f"Error running {script_path}:\n{e}")

def git_commit_changes():
    try:
        subprocess.run(["git", "add", "."], check=True)
        subprocess.run(["git", "commit", "-m", "Automated commit of changes made by handler.py"], check=True)
        print("Changes committed successfully.")
    except subprocess.CalledProcessError as e:
        print(f"Error committing changes:\n{e}")

if __name__ == "__main__":
    idiot_check = input("Please confirm you have uploaded the full resolution gallery to the file hosting site (github) prior to running this script. \nYour images are about to be irreversably compressed for website hosting. (yes/no): ")
    if idiot_check.lower() != 'yes':
        print("Make good decisions.")
        exit()
    scripts = [
        'img_resizer.py',
        'gallery_generator.py',
        'manifest_generator.py',
        'secrets_setter.py'
    ]

    for script in scripts:
        run_script(script)

    git_commit_changes()