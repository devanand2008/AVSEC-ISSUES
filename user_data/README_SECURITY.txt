================================================================================
                       CRITICAL SECURITY NOTICE
================================================================================

This directory (user_data/) contains sensitive student and staff information,
including College IDs, email addresses, and temporary or personal passwords.

UNDER NO CIRCUMSTANCES should real data files in this directory be:
- Committed to Git
- Pushed to GitHub
- Included in Git history
- Included in Render builds or Docker images
- Stored in frontend public assets
- Exposed through a public URL
- Printed in application logs
- Uploaded as environment variables or ZIP bundles

Only the following files are permitted to be tracked in this directory:
- user_data/.gitkeep
- user_data/README_SECURITY.txt
- user_data/templates/student-import-template.xlsx (must contain FAKE sample data ONLY)

All real student workbooks (e.g., AVSEC USER NAME AND PASSWORD FOR 2RD YEAR.xlsx)
MUST remain untracked and private on the local computer or secure local storage.
================================================================================
