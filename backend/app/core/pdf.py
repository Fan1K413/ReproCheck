from threading import Lock

# PyMuPDF must be used by only one thread at a time within a process.
PDF_ENGINE_LOCK = Lock()
