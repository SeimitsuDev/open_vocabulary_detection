from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from detector import YoloWorldDetector
from pydantic import BaseModel
import os
import shutil
import glob
import json
import asyncio

app = FastAPI()

# allowing cors so frontend can talk to backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# globle instance of detector
detector = YoloWorldDetector()

# model class for req
class ProcessRequest(BaseModel):
    input_folder: str
    output_folder: str
    custom_classes: str
    force: bool = False
    max_process_count: int = 100

class ScanRequest(BaseModel):
    input_folder: str

def get_all_images(folder_path):
    extensions = ('*.png', '*.jpg', '*.jpeg', '*.webp', '*.PNG', '*.JPG', '*.JPEG')
    files = []
    for ext in extensions:
        # checking in child directory as well
        files.extend(glob.glob(os.path.join(folder_path, '**', ext), recursive=True))
    return files

@app.post("/scan_folder")
async def scan_folder(req: ScanRequest):
    if not os.path.isdir(req.input_folder):
         return {"count": 0}
    images = get_all_images(req.input_folder)
    return {"count": len(images)}

@app.post("/process_folder")
async def process_folder(req: ProcessRequest):
    if not os.path.isdir(req.input_folder):
        return {"status": "error", "message": "invalid input folder"}
        
    if not os.path.exists(req.output_folder):
        # make output folder if not there
        os.makedirs(req.output_folder, exist_ok=True)
        
    # check if output folder is empty
    if not req.force:
        output_files = os.listdir(req.output_folder)
        if len(output_files) > 0:
            return {"status": "needs_confirmation", "message": "Output folder is not empty. Should I proceed and add files to it?"}
            
    # async genrator for streaming response back to frontend
    async def event_stream():
        images = get_all_images(req.input_folder)
        # sort according to assending order
        images.sort()
        
        # user can manipulate the number
        if len(images) > req.max_process_count:
            # this sytem will only process customized count
            images = images[:req.max_process_count]
            
        if len(images) == 0:
            yield json.dumps({"type": "error", "message": "No images found in the input folder."}) + "\n"
            return
            
        # tell frontend we started
        yield json.dumps({"type": "start", "total": len(images)}) + "\n"
        
        copied_count = 0
        
        # it will process them all
        for i, img_path in enumerate(images):
            file_name = os.path.basename(img_path)
            
            # send progress
            yield json.dumps({"type": "progress", "current": i + 1, "filename": file_name}) + "\n"
            await asyncio.sleep(0.01) # flush to frontend
            
            # if there is an image preset in the output dir then it shold not copy at that time
            dest_path = os.path.join(req.output_folder, file_name)
            if os.path.exists(dest_path):
                yield json.dumps({"type": "log", "msg": f"[~] Skipped: {file_name} already exists in output."}) + "\n"
                continue
                
            # find the labels user put
            detections = detector.detect_objects_in_file(img_path, req.custom_classes)
            
            # which every the image has it the model list them
            if len(detections) > 0:
                # and python will copy them and store at a folder user select
                shutil.copy2(img_path, dest_path)
                copied_count += 1
                yield json.dumps({"type": "log", "msg": f"[+] MATCH FOUND: {file_name} -> Copied!"}) + "\n"
            else:
                yield json.dumps({"type": "log", "msg": f"[-] No match: {file_name}"}) + "\n"
                
        yield json.dumps({"type": "done", "copied": copied_count}) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")

if __name__ == "__main__":
    import uvicorn
    # runing the server on port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
