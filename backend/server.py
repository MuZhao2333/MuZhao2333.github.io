"""Single-worker queued molecular model API and static website host."""
from __future__ import annotations
import logging
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from engines import Engine, MODEL_INFO

logging.basicConfig(level=logging.INFO)
HERE=Path(__file__).resolve().parent
app=FastAPI(title="MolFLAE / MolAlign3D Demo",docs_url=None,redoc_url=None)
allowed_origins=[x.strip() for x in os.environ.get("DEMO_ALLOWED_ORIGINS","").split(",") if x.strip()]
if allowed_origins:
    app.add_middleware(CORSMiddleware,allow_origins=allowed_origins,allow_methods=["GET","POST"],allow_headers=["Content-Type"])
pool=ThreadPoolExecutor(max_workers=1,thread_name_prefix="model-inference")
jobs={}
guard=threading.Lock()
engine=None
MAX_PENDING=4

class Input(BaseModel):
    model_config=ConfigDict(extra="forbid")
    smiles:str=Field(default="",max_length=1000)
    molblock:str=Field(default="",max_length=200000)

class EncodeRequest(Input):
    model:Literal["molflae","molalign3d"]="molalign3d"
    seed:int=Field(default=42,ge=0,le=2147483647)
    steps:int=Field(default=100,ge=10,le=200)

class DecodeRequest(BaseModel):
    model_config=ConfigDict(extra="forbid")
    encoding_id:str=Field(min_length=32,max_length=32,pattern=r"^[a-f0-9]{32}$")
    steps:int=Field(default=100,ge=10,le=200)
    seed:int=Field(default=42,ge=0,le=2147483647)

class InterpolateRequest(BaseModel):
    model_config=ConfigDict(extra="forbid")
    model:Literal["molflae","molalign3d"]="molalign3d"
    a:Input
    b:Input
    frames:int=Field(default=11,ge=3,le=21)
    steps:int=Field(default=100,ge=10,le=200)
    seed:int=Field(default=42,ge=0,le=2147483647)
    align:bool=True

class WanderRequest(EncodeRequest):
    frames:int=Field(default=7,ge=2,le=11)
    step_size:float=Field(default=0.1,ge=0,le=1,allow_inf_nan=False)
    space:Literal["zx","zh","both"]="both"

class AtomEditRequest(EncodeRequest):
    radius:int=Field(default=2,ge=0,le=4)

class SwapRequest(BaseModel):
    model_config=ConfigDict(extra="forbid")
    model:Literal["molflae","molalign3d"]="molalign3d"
    a:Input
    b:Input
    steps:int=Field(default=100,ge=10,le=200)
    seed:int=Field(default=42,ge=0,le=2147483647)
    align:bool=True

class LatentSelection(BaseModel):
    model_config=ConfigDict(extra="forbid")
    model:Literal["molflae","molalign3d"]="molalign3d"
    point_id:str=Field(min_length=1,max_length=100)

class LatentNavigation(BaseModel):
    model_config=ConfigDict(extra="forbid")
    model:Literal["molflae","molalign3d"]="molalign3d"
    point_id:Optional[str]=Field(default=None,min_length=1,max_length=100)
    encoding_id:Optional[str]=Field(default=None,pattern=r"^[a-f0-9]{32}$")
    map_version:str=Field(min_length=16,max_length=16)
    delta_x:float=Field(default=0,ge=-3,le=3,allow_inf_nan=False)
    delta_y:float=Field(default=0,ge=-3,le=3,allow_inf_nan=False)
    frames:int=Field(default=5,ge=2,le=11)
    steps:int=Field(default=100,ge=10,le=200)
    seed:int=Field(default=42,ge=0,le=2147483647)

def submit(operation,args):
    with guard:
        now=time.time()
        for key in list(jobs):
            if jobs[key]["status"] in ("complete","error") and now-jobs[key]["created"]>1800:
                del jobs[key]
        if sum(job["status"] in ("queued","running") for job in jobs.values())>=MAX_PENDING:
            raise HTTPException(429,"The inference queue is full. Please try again shortly.")
        if len(jobs)>=32:
            finished=[key for key in jobs if jobs[key]["status"] in ("complete","error")]
            for key in finished[:len(jobs)-31]:
                del jobs[key]
        token=uuid.uuid4().hex
        jobs[token]={"id":token,"status":"queued","message":"Waiting for the model worker","progress":0.,"created":now}

    def update(message,progress):
        with guard:
            jobs[token].update(message=message,progress=round(float(progress),3))

    def work():
        global engine
        try:
            with guard:
                jobs[token]["status"]="running"
            if engine is None:
                update("Initializing model runtime",0.02)
                engine=Engine()
            result=getattr(engine,operation)(progress=update,**args)
            with guard:
                jobs[token].update(status="complete",progress=1.,message="Complete",result=result)
        except ValueError as error:
            with guard:
                jobs[token].update(status="error",message=str(error))
        except Exception:
            logging.exception("Model job %s failed",token)
            with guard:
                jobs[token].update(status="error",message="Inference failed. Please try a smaller molecule or contact the demo owner.")
    pool.submit(work)
    return {"job_id":token}

@app.get("/api/models")
def models():
    return {"models":[{"id":key,"name":info["name"],"global_nodes":info["global_nodes"],
        "structural_dim":info["structural_dim"],"decoder_dim":info["decoder_dim"],
        "checkpoint":info["checkpoint"],"source_revision":info.get("source_revision"),
        **{field:info[field] for field in ("checkpoint_asset","checkpoint_sha256","code_repository","code_revision","inference_module")},
        "weights_verified":engine is not None and key in engine.verified,
        "conditioning":info.get("conditioning","No external semantic conditioning"),
        "loaded":engine is not None and key in engine.models}
        for key,info in MODEL_INFO.items()],"max_atoms":80,"max_frames":21,
        "configured_device":os.environ.get("MOLECULAR_DEVICE","auto"),
        "device":str(engine.device) if engine is not None else "Initialized on first inference"}

@app.get("/api/health")
def health():
    return {"status":"ok","worker":"serialized","pending":sum(j["status"] in ("queued","running") for j in jobs.values()),
            "backend_repository":"MuZhao2333.github.io","backend_revision":os.environ.get("BACKEND_CODE_REVISION","unrecorded"),
            "configured_device":os.environ.get("MOLECULAR_DEVICE","auto"),
            "device":str(engine.device) if engine is not None else None}

@app.post("/api/latent-select",status_code=202)
def latent_select(request:LatentSelection):
    data=request.model_dump();data['key']=data.pop('model')
    return submit('latent_select',data)

@app.post("/api/latent-locate",status_code=202)
def latent_locate(request:EncodeRequest):
    data=request.model_dump();data['key']=data.pop('model');data.pop('steps')
    return submit('latent_locate',data)

@app.post("/api/latent-navigate",status_code=202)
def latent_navigate(request:LatentNavigation):
    data=request.model_dump();data['key']=data.pop('model')
    return submit('latent_navigate',data)

@app.post("/api/encode",status_code=202)
def encode(request:EncodeRequest):
    data=request.model_dump()
    data["key"]=data.pop("model")
    data.pop("steps")
    return submit("encode",data)

@app.post("/api/reconstruct",status_code=202)
def reconstruct(request:EncodeRequest):
    data=request.model_dump()
    data["key"]=data.pop("model")
    return submit("reconstruct",data)

@app.post("/api/decode",status_code=202)
def decode(request:DecodeRequest):
    return submit("decode",request.model_dump())

@app.post("/api/interpolate",status_code=202)
def interpolate(request:InterpolateRequest):
    data=request.model_dump()
    data["key"]=data.pop("model")
    return submit("interpolate",data)

@app.post("/api/wander",status_code=202)
def wander(request:WanderRequest):
    data=request.model_dump()
    data["key"]=data.pop("model")
    return submit("wander",data)

@app.post("/api/atom-edit",status_code=202)
def atom_edit(request:AtomEditRequest):
    data=request.model_dump()
    data["key"]=data.pop("model")
    return submit("atom_edit",data)

@app.post("/api/swap",status_code=202)
def swap(request:SwapRequest):
    data=request.model_dump()
    data["key"]=data.pop("model")
    return submit("swap",data)

@app.get("/api/jobs/{job_id}")
def get_job(job_id:str):
    with guard:
        job=jobs.get(job_id)
        if not job:
            raise HTTPException(404,"Job not found or expired.")
        return dict(job)

class PublicSiteFiles(StaticFiles):
    async def get_response(self, path, scope):
        first = path.lstrip("/").split("/", 1)[0]
        public = {"", ".", "index.html", "styles.css", "layout.css", "visual.css", "assets", "models", "photography", "robots.txt", "sitemap.xml"}
        if first not in public:
            raise HTTPException(404, "Not found")
        return await super().get_response(path, scope)


homepage = Path(os.environ.get("HOMEPAGE_ROOT", str(HERE.parent)))
if (homepage / "index.html").is_file():
    app.mount("/", PublicSiteFiles(directory=str(homepage), html=True), name="homepage")
else:
    @app.get("/")
    def index():
        return RedirectResponse("https://muzhao2333.github.io/models/")
