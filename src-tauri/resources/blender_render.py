import argparse, json, math, os, sys
import bpy
from mathutils import Vector

def progress(stage, value, message, device=None, fallback=None):
    payload = {"jobId": "", "stage": stage, "progress": value, "message": message, "device": device, "fallback": fallback}
    print("ANPACK_PROGRESS " + json.dumps(payload, ensure_ascii=False), flush=True)

def configure_device(requested):
    preferences = bpy.context.preferences.addons["cycles"].preferences
    priorities = [requested.upper()] if requested != "auto" else ["OPTIX", "CUDA", "HIP", "ONEAPI"]
    for kind in priorities:
        try:
            preferences.compute_device_type = kind
            preferences.get_devices()
            devices = [device for device in preferences.devices if device.type == kind]
            if devices:
                for device in preferences.devices: device.use = device in devices or device.type == "CPU"
                return kind, None
        except Exception:
            pass
    preferences.compute_device_type = "NONE"
    return "CPU", None if requested in ("auto", "cpu") else f"{requested} 不可用，已回退 CPU"

def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()

def three_to_blender(value):
    return (value[0], -value[2], value[1])

def add_area(name, location, energy, size, color, target):
    data = bpy.data.lights.new(name, "AREA"); data.energy = energy; data.shape = "DISK"; data.size = size; data.color = color
    obj = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(obj); obj.location = location; look_at(obj, target)

parser = argparse.ArgumentParser(); parser.add_argument("--job", required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
with open(args.job, "r", encoding="utf-8") as handle: job = json.load(handle)
progress("building", 12, "正在载入 GLB 场景")
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=job["glbPath"])
scene = bpy.context.scene; scene.render.engine = "BLENDER_EEVEE_NEXT"
try: scene.render.engine = "CYCLES"
except Exception: pass
scene.cycles.samples = int(job["samples"]); scene.cycles.max_bounces = int(job["bounces"]); scene.cycles.use_adaptive_sampling = bool(job["adaptiveSampling"])
scene.render.resolution_x = int(job["width"]); scene.render.resolution_y = int(job["height"]); scene.render.resolution_percentage = 100
scene.render.film_transparent = bool(job["transparent"]); scene.render.image_settings.file_format = job["format"]
if job["format"] == "JPEG": scene.render.image_settings.quality = round(float(job["quality"]) * 100)
scene.render.filepath = job["outputPath"]
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = math.log(max(float(job["lighting"]["exposure"]), 0.01), 2)
device, fallback = configure_device(job["device"]); scene.cycles.device = "GPU" if device != "CPU" else "CPU"
progress("building", 28, f"渲染设备：{device}", device, fallback)
camera_data = bpy.data.cameras.new("Anpack Camera"); camera = bpy.data.objects.new("Anpack Camera", camera_data); bpy.context.collection.objects.link(camera)
camera.location = three_to_blender(job["camera"]["position"]); camera_data.lens = 50 * 34 / max(float(job["camera"]["fov"]), 1); look_at(camera, three_to_blender(job["camera"]["target"])); scene.camera = camera
if job["camera"].get("depthOfField"):
    camera_data.dof.use_dof = True; camera_data.dof.focus_distance = float(job["camera"]["focusDistance"]); camera_data.dof.aperture_fstop = float(job["camera"]["fStop"])
for obj in list(bpy.data.objects):
    if obj.type == "LIGHT": bpy.data.objects.remove(obj, do_unlink=True)
lighting = job["lighting"]; target = three_to_blender(job["camera"]["target"])
add_area("Key", three_to_blender(lighting["keyPosition"]), float(lighting["key"]) * 450, float(lighting["keySize"]), (1.0, .82, .66), target)
add_area("Fill", three_to_blender((-4, 3, 3)), float(lighting["fill"]) * 300, float(lighting["fillSize"]), (.62, .78, 1.0), target)
world = bpy.data.worlds.new("Anpack World") if not bpy.data.worlds else bpy.data.worlds[0]; scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (*[int(job["scene"]["background"][i:i+2],16)/255 for i in (1,3,5)],1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = max(.05, float(lighting["environmentIntensity"]))
if job["scene"].get("floor"):
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0,0,0)); floor=bpy.context.object; floor.name="Anpack Floor"
    material=bpy.data.materials.new("Floor"); material.diffuse_color=(*world.node_tree.nodes["Background"].inputs["Color"].default_value[:3],1); material.roughness=float(job["scene"].get("floorRoughness",.75)); floor.data.materials.append(material)
scene.render.image_settings.color_mode = "RGBA" if job["transparent"] else "RGB"
scene.cycles.use_denoising = bool(job["denoise"])
progress("sampling", 36, f"Cycles 正在采样 · {job['samples']} samples", device, fallback)
bpy.ops.render.render(write_still=True)
progress("encoding", 95, "正在写入最终图像", device, fallback)
if not os.path.exists(job["outputPath"]): raise RuntimeError("输出文件未生成")
progress("done", 100, "Cycles 渲染完成", device, fallback)
