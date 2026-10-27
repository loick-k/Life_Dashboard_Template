"""Read/render the three explicitly synthetic QA reports; never opens application data."""
from pathlib import Path
from pypdf import PdfReader
import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / "artifacts" / "output" / "pdf"
cases = {
    "rapport-travail-synthetique.pdf": ["+1h48", "24h36", "18:00 - 18:30", "Télétravail", "Déplacement", "08:55 - n.c."],
    "rapport-travail-vide.pdf": ["Aucune durée calculable", "n.c.", "0 journée(s) comptée(s)"],
    "rapport-travail-partiel.pdf": ["-45h30", "0h00", "18:00 - n.c.", "1 journée(s) aux horaires chevauchants"],
}
for name, expected in cases.items():
    path = FOLDER / name
    reader = PdfReader(path, strict=True)
    assert len(reader.pages) == 2, name
    assert "/OpenAction" not in reader.trailer["/Root"]
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    for value in ["Rapport du temps de travail", "Créneau 3", "Cumul total", "PDF non chiffré", "1 / 2", "2 / 2", *expected]:
        assert value in text, (name, value)
    with pdfplumber.open(path) as document:
        for index, page in enumerate(document.pages):
            assert page.width == 842 and page.height == 595
            for character in page.chars:
                assert 40 <= character["x0"] < character["x1"] <= 802, (name, index, "horizontal clipping")
                assert 20 <= character["top"] < character["bottom"] <= 580, (name, index, "vertical clipping")
            # Body and footer are distinct; no text may run through the footer separator.
            assert all(not (char["top"] < 556 < char["bottom"]) for char in page.chars), (name, index, "footer overlap")
    print(f"{name}: 2 pages, content/structure/bounds verified; synthetic only")
