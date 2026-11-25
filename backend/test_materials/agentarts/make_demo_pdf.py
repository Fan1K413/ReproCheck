"""Create the text-layer PDF used in the AgentArts live demo."""
from pathlib import Path

import fitz

here = Path(__file__).resolve().parent
title, *body = (here / "synthetic-paper.txt").read_text(encoding="utf-8").splitlines()
with fitz.open() as document:
    page = document.new_page()
    page.insert_text((55, 70), title.replace("—", "-"), fontsize=15, fontname="hebo")
    for index, line in enumerate(filter(None, body)):
        page.insert_text((55, 115 + index * 25), line, fontsize=12)
    document.set_metadata({"title": "Synthetic submission - ReproCheck competition sample"})
    document.save(here / "synthetic-paper.pdf")
