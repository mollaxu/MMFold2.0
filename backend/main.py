import os
import subprocess
import tempfile
import shutil
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MOSCLIENT = "/Users/xuxin/Library/Python/3.9/bin/mosclient"
MMFOLD_URL = "https://internal-model.moleculemind.com/model/mos-mmfold"


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    if not file.filename.endswith((".pdb", ".cif")):
        raise HTTPException(status_code=400, detail="只支持 .pdb 或 .cif 文件")

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, file.filename)
        output_dir = os.path.join(tmpdir, "output")
        os.makedirs(output_dir)

        with open(input_path, "wb") as f:
            f.write(await file.read())

        result = subprocess.run(
            [
                MOSCLIENT,
                "-u", MMFOLD_URL,
                "-p", f'{{"structure_path": "{input_path}"}}',
                "-o", output_dir,
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr)

        output_files = {}
        for f in Path(output_dir).rglob("*"):
            if f.is_file():
                output_files[f.name] = f.read_text(errors="ignore")

        return JSONResponse({"status": "success", "files": output_files, "log": result.stdout})


@app.get("/api/health")
def health():
    return {"status": "ok"}
