---
title: Week 1｜YOLOv8n × BDD100K（5k 子集）复现与解读
date: 2025-08-24
order: 1
isOriginal: true
article: true
timeline: true
tags:
  - Autonomous Driving
  - Object Detection
  - YOLOv8
  - BDD100K
  - Reproducibility
---


> 一周复现系列（W1）。本篇记录我从数据下载到训练评测的完整过程，并提供**一键复现命令清单**与**结果解读**（mAP 的含义与读法）。

## TL;DR（结果速览）
- 训练集：**BDD100K 5k 子集**（按 8 类筛选）；验证集：**官方 val 全量 10k**
- 模型与设置：`yolov8n.pt`，`imgsz=960`，`batch=16`，**GPU: Tesla T4 16GB**
- 训练：**50 epochs**，耗时 **≈2.37 h**
- 指标（val, 10k 图）：**mAP50=0.489，mAP50-95=0.281；P=0.581，R=0.459**
- 结论：总体可作为**入门基线**；**小目标类（person/bicycle）**召回偏低，提升分辨率与增广可改善。

---

## 一、环境与目录
```bash
mamba create -n adv_w1 python=3.10 -y
mamba activate adv_w1
pip install ultralytics opencv-python-headless tqdm
````

目录（ETHZ 镜像解压后的常见结构）：

```
data/bdd100k/
  images/100k/{train,val,test}/*.jpg
  labels/
    det_20/{det_train.json, det_val.json}  # Detection 2020（Scalabel/COCO混合来源）
    100k/{train,val}                       # YOLO 文本标注（生成后/软链）
```

> 软链对齐（让 `images/100k/...` 能映射到 `labels/100k/...`）：

```bash
mkdir -p data/bdd100k/labels/100k
ln -sfn ../train data/bdd100k/labels/100k/train
ln -sfn ../val   data/bdd100k/labels/100k/val
```

## 二、数据准备与标注转换

### 1) 下载（ETHZ 镜像）

```bash
# 建议逐个下载，避免 416
aria2c -c -x8 -s8 -k1M https://dl.cv.ethz.ch/bdd100k/data/100k_images_train.zip
aria2c -c -x8 -s8 -k1M https://dl.cv.ethz.ch/bdd100k/data/100k_images_val.zip
aria2c -c -x8 -s8 -k1M https://dl.cv.ethz.ch/bdd100k/data/bdd100k_det_20_labels_trainval.zip
unzip -q 100k_images_train.zip
unzip -q 100k_images_val.zip
unzip -q bdd100k_det_20_labels_trainval.zip
```

> 也可使用自定义脚本：`bash bdd100k_downloader.sh --size 100k --dir ./data`

### 2) 生成 5k 训练子集（兼容 Scalabel/COCO）

```bash
python w1/scripts/make_subset_any.py \
  --labels-json  data/bdd100k/labels/det_20/det_train.json \
  --images-root  data/bdd100k/images/100k/train \
  --save-json    data/bdd100k/labels/det_20/det_train_5k.json \
  --max-images   5000 \
  --classes      car bus truck person bicycle motorcycle "traffic light" "traffic sign"
```

### 3) 转 YOLO 文本标注

```bash
# train（5k 子集）
python w1/scripts/coco_to_yolo.py \
  --coco-json   data/bdd100k/labels/det_20/det_train_5k.json \
  --images-root data/bdd100k/images/100k/train \
  --labels-root data/bdd100k/labels/train \
  --classes car bus truck person bicycle motorcycle "traffic light" "traffic sign"

# val（先转 COCO 再转 YOLO；避免 Scalabel 直接读失败）
python w1/scripts/make_subset_any.py \
  --labels-json  data/bdd100k/labels/det_20/det_val.json \
  --images-root  data/bdd100k/images/100k/val \
  --save-json    data/bdd100k/labels/det_20/det_val_coco.json \
  --max-images   999999 \
  --classes      car bus truck person bicycle motorcycle "traffic light" "traffic sign"

python w1/scripts/coco_to_yolo.py \
  --coco-json   data/bdd100k/labels/det_20/det_val_coco.json \
  --images-root data/bdd100k/images/100k/val \
  --labels-root data/bdd100k/labels/val \
  --classes car bus truck person bicycle motorcycle "traffic light" "traffic sign"
```

### 4) 数据集配置（`data/bdd100k/bdd5k.yaml`）

```yaml
path: data/bdd100k
train: train_5k.txt         # 相对 path，真实文件为 data/bdd100k/train_5k.txt
val:   images/100k/val
names:
  0: car
  1: bus
  2: truck
  3: person
  4: bicycle
  5: motorcycle
  6: traffic light
  7: traffic sign
```

> 将 5k 训练图片清单写入 `data/bdd100k/train_5k.txt`（避免 7 万无标注图被当背景）：

```bash
python - <<'PY'
import json, os
subset='data/bdd100k/labels/det_20/det_train_5k.json'
img_root=os.path.abspath('data/bdd100k/images/100k/train')
d=json.load(open(subset,'r',encoding='utf-8'))
names={os.path.basename(x['file_name']) for x in d['images']}
with open('data/bdd100k/train_5k.txt','w') as f:
    for n in sorted(names): f.write(os.path.join(img_root,n)+'\n')
print('wrote', len(names), 'lines')
PY
```

## 三、训练

```bash
yolo detect train data=data/bdd100k/bdd5k.yaml \
  model=yolov8n.pt imgsz=960 epochs=50 batch=16 workers=8 device=0 \
  name=bdd5k_yolov8n_960_subset5k2
```

* Ultralytics: **8.3.179**；PyTorch **2.8.0+cu128**；GPU: **Tesla T4 16GB**
* 优化器自动选择：**AdamW(lr≈0.000833)**
* 训练耗时：**≈2.371 h / 50 epochs**

## 四、评测结果（mAP 详解）

* **整体**：`P=0.581`, `R=0.459`, **`mAP50=0.489`, `mAP50-95=0.281`**
* **按类（mAP50）**：car 0.767，traffic light 0.587，motorcycle 0.544，truck 0.499，bus 0.485，person 0.312，bicycle 0.226
* **速度**：pre 0.2ms / infer 2.4ms / post 1.2ms per image

**mAP 解释**

* **AP**：在某个 IoU 阈值下，PR 曲线下面积；**mAP**：对所有类别的 AP 取平均。
* **mAP50**：IoU=0.50（宽松）；**mAP50-95**：IoU 0.50→0.95 每 0.05 一档的平均（严格）。
* 你的结果显示召回偏低（R≈0.46），小目标类更难 → 可通过更高分辨率与增广改进。

> 生成曲线与混淆矩阵：

```bash
yolo detect val data=data/bdd100k/bdd5k.yaml \
  model=runs/detect/bdd5k_yolov8n_960_subset5k2/weights/best.pt \
  plots=True save_json=True device=0
```

## 五、误差分析与可视化

* **远距小目标**（person/bicycle）：细节不足导致漏检、框偏小
* **背光/夜间**：低照/高对比 → 误检
* **遮挡/密集**：NMS 后漏检

导出预测样例（做“误检/漏检案例墙”）：

```bash
yolo detect predict source=data/bdd100k/images/100k/val \
  model=runs/detect/bdd5k_yolov8n_960_subset5k2/weights/best.pt \
  conf=0.25 save=True max_det=300 device=0
```

## 六、立刻可做的改进实验

> 每条独立尝试，**更换 `name=`**，避免覆盖。

```bash
# 1) 更高分辨率（冲小目标）
yolo detect train data=data/bdd100k/bdd5k.yaml model=yolov8n.pt imgsz=1280 batch=8 epochs=50 device=0 name=bdd5k_yolov8n_1280

# 2) 轻度增广（mosaic/mixup）
yolo detect train data=data/bdd100k/bdd5k.yaml model=yolov8n.pt imgsz=960 epochs=50 mosaic=0.8 mixup=0.1 hsv_h=0.015 hsv_s=0.7 hsv_v=0.4 device=0 name=bdd5k_yolov8n_aug

# 3) 更长训练 + 余弦退火
yolo detect train data=data/bdd100k/bdd5k.yaml model=yolov8n.pt imgsz=960 epochs=100 cos_lr=True device=0 name=bdd5k_yolov8n_100ep

# 4) 更大模型（提升上限）
yolo detect train data=data/bdd100k/bdd5k.yaml model=yolov8s.pt imgsz=960 epochs=50 batch=16 device=0 name=bdd5k_yolov8s_960
```

## 七、导出与部署（可选）

```bash
# 导出 ONNX
yolo export model=runs/detect/bdd5k_yolov8n_960_subset5k2/weights/best.pt format=onnx opset=12

# 用 ONNX 推理一次校验
yolo detect predict source=data/bdd100k/images/100k/val \
  model=runs/detect/bdd5k_yolov8n_960_subset5k2/weights/best.onnx \
  conf=0.25 save=True device=0
```

## 八、踩坑与排错清单

* **`no labels found`**：对齐 `images/100k/...` ↔ `labels/100k/...`；
* **Scalabel 读取报错**：先转 COCO 再转 YOLO；
* **OpenCV 导入失败**：用 `opencv-python-headless` 或安装 `libgl1 libglib2.0-0`；
* **下载 416**：分开下载、降低并发或用 `wget -c`；
* **`path` 与 `train` 重复前缀**：`train` 应相对 `path`，或将 `path` 设为 `.` 并用绝对路径。

## 九、结语

本篇完成了 BDD100K 上 YOLOv8n 的从零到一复现与指标解读。作为**入门基线**，它已经可用于下游（如 MOT 的 ByteTrack 输入）。下一篇将在**车道线检测**或**单目深度**之间选择作为 W2 主题。

## 附录

训练脚本
```bash
#!/usr/bin/env bash
# Week1 end-to-end pipeline: YOLOv8n × BDD100K (5k subset)
# 作用：环境准备 -> 下载/解压 -> 标注转换 -> 训练/验证/预测
# 需求：Ubuntu + Mambaforge/Conda（建议）+ NVIDIA 驱动（GPU 可选）
# 用法：bash week1_all.sh

set -euo pipefail

### ----------------------- 基础变量 -----------------------
PROJ_ROOT="${PROJ_ROOT:-$PWD}"
DATA_DIR="$PROJ_ROOT/data"
BDD_DIR="$DATA_DIR/bdd100k"
ENV_NAME="${ENV_NAME:-adv_w1}"
RUN="mamba run -n $ENV_NAME"   # 不改变父 shell 的情况下使用环境
RUN_NAME="${RUN_NAME:-bdd5k_yolov8n_960_subset5k}"
TRAIN_IMGSZ="${TRAIN_IMGSZ:-960}"
EPOCHS="${EPOCHS:-50}"
BATCH="${BATCH:-16}"
DEVICE="${DEVICE:-0}"          # 指定 GPU；CPU 调试可设为 cpu

echo "==> PROJ_ROOT=$PROJ_ROOT"
echo "==> DATA_DIR=$DATA_DIR"
echo "==> BDD_DIR=$BDD_DIR"

mkdir -p "$BDD_DIR" "$PROJ_ROOT/w1/scripts"

### ----------------------- 系统依赖 -----------------------
echo "==> 安装系统依赖（aria2/unzip；GPU 不需要额外包）"
if ! command -v aria2c >/dev/null 2>&1; then
  (apt-get update -y || true) && apt-get install -y aria2 || true
fi
apt-get install -y unzip || true

### ----------------------- Python 环境 -----------------------
if ! command -v mamba >/dev/null 2>&1 && command -v conda >/dev/null 2>&1; then
  # 没有 mamba 就用 conda
  alias mamba=conda
fi

if ! mamba env list | grep -q "^$ENV_NAME"; then
  echo "==> 创建环境 $ENV_NAME"
  mamba create -y -n "$ENV_NAME" python=3.10
fi

echo "==> 安装 Python 依赖（ultralytics / pillow / opencv-python-headless / tqdm）"
$RUN python - <<'PY'
import sys, subprocess
pip = [sys.executable, "-m", "pip"]
subprocess.check_call(pip + ["install", "-U", "pip"])
subprocess.check_call(pip + ["install", "ultralytics", "pillow", "opencv-python-headless", "tqdm"])
PY

### ----------------------- 下载 BDD100K -----------------------
cd "$DATA_DIR"
echo "==> 下载 BDD100K（ETHZ 镜像；images 100k + det_20 labels）"
download() {
  local url="$1"
  if command -v aria2c >/dev/null 2>&1; then
    aria2c -c -x8 -s8 -k1M "$url"
  else
    wget -c "$url"
  fi
}

download https://dl.cv.ethz.ch/bdd100k/data/100k_images_train.zip
download https://dl.cv.ethz.ch/bdd100k/data/100k_images_val.zip
download https://dl.cv.ethz.ch/bdd100k/data/bdd100k_det_20_labels_trainval.zip

# 只有 images 有 md5；labels 没有 md5 是正常的
download https://dl.cv.ethz.ch/bdd100k/data/100k_images_train.zip.md5 || true
download https://dl.cv.ethz.ch/bdd100k/data/100k_images_val.zip.md5   || true
if command -v md5sum >/dev/null 2>&1; then
  [ -f 100k_images_train.zip.md5 ] && md5sum -c 100k_images_train.zip.md5
  [ -f 100k_images_val.zip.md5 ]   && md5sum -c 100k_images_val.zip.md5
fi

echo "==> 解压..."
unzip -q -n 100k_images_train.zip
unzip -q -n 100k_images_val.zip
unzip -q -n bdd100k_det_20_labels_trainval.zip

# 目录对齐与软链
cd "$PROJ_ROOT"
echo "==> 创建对齐软链 images/train|val -> images/100k/*"
ln -sfn "$BDD_DIR/images/100k/train" "$BDD_DIR/images/train"
ln -sfn "$BDD_DIR/images/100k/val"   "$BDD_DIR/images/val"

mkdir -p "$BDD_DIR/labels/100k" "$BDD_DIR/labels/train" "$BDD_DIR/labels/val"
ln -sfn ../train "$BDD_DIR/labels/100k/train"
ln -sfn ../val   "$BDD_DIR/labels/100k/val"

### ----------------------- 准备脚本（兼容 Scalabel/COCO） -----------------------
echo "==> 写入 make_subset_any.py（兼容 Scalabel/COCO；输出 COCO 子集）"
cat > "$PROJ_ROOT/w1/scripts/make_subset_any.py" <<'PY'
#!/usr/bin/env python
# 兼容 BDD100K 的 COCO 与 Scalabel，抽样为 COCO 子集
import os, json, argparse, random
from pathlib import Path
try:
    import cv2
except Exception:
    cv2 = None

def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels-json", required=True)
    ap.add_argument("--images-root", required=True)
    ap.add_argument("--save-json", required=True)
    ap.add_argument("--max-images", type=int, default=5000)
    ap.add_argument("--classes", nargs="+", required=True)
    ap.add_argument("--seed", type=int, default=42)
    return ap.parse_args()

def load_json(p): return json.load(open(p, "r", encoding="utf-8"))
def is_coco(x): return isinstance(x, dict) and all(k in x for k in ["images","annotations","categories"])

def to_coco_from_scalabel(frames, images_root, keep_names):
    if cv2 is None:
        raise SystemExit("需要 opencv-python-headless：pip install opencv-python-headless")
    seen, cat2id = [], {}
    for fr in frames:
        for lb in fr.get("labels", []):
            c = lb.get("category")
            if c and c not in seen:
                seen.append(c)
    for i,n in enumerate([n for n in seen if n in keep_names], start=1):
        cat2id[n] = i
    images, annotations = [], []
    iid, aid = 1, 1
    for fr in frames:
        name = fr.get("name"); 
        if not name: continue
        fn = Path(name).name
        p = Path(images_root)/fn
        if not p.exists(): p = Path(images_root)/name
        if not p.exists(): continue
        im = cv2.imread(str(p))
        if im is None: continue
        h,w = im.shape[:2]
        labs=[]
        for lb in fr.get("labels", []):
            cat=lb.get("category"); box=lb.get("box2d")
            if not box or cat not in cat2id: continue
            x1,y1 = float(box.get("x1",0)), float(box.get("y1",0))
            x2,y2 = float(box.get("x2",0)), float(box.get("y2",0))
            bw,bh = max(0.0,x2-x1), max(0.0,y2-y1)
            if bw<=1e-6 or bh<=1e-6: continue
            labs.append((cat2id[cat], x1,y1,bw,bh))
        if not labs: continue
        images.append({"id": iid, "file_name": fn, "width": w, "height": h})
        for (cid,x,y,bw,bh) in labs:
            annotations.append({"id": aid,"image_id": iid,"category_id": cid,"bbox":[x,y,bw,bh],"area":bw*bh,"iscrowd":0})
            aid+=1
        iid+=1
    categories=[{"id":v,"name":k} for k,v in cat2id.items()]
    return {"images":images,"annotations":annotations,"categories":categories}

def filter_and_sample_coco(coco, keep_names, max_images, seed=42):
    name2id={c["name"]:c["id"] for c in coco["categories"]}
    keep_ids={name2id[n] for n in keep_names if n in name2id}
    from collections import defaultdict
    by_img=defaultdict(list)
    for a in coco["annotations"]:
        if a.get("category_id") in keep_ids: by_img[a["image_id"]].append(a)
    valid=[img for img in coco["images"] if by_img.get(img["id"])]
    random.seed(seed); random.shuffle(valid)
    chosen={img["id"] for img in valid[:max_images]}
    images=[i for i in coco["images"] if i["id"] in chosen]
    anns=[a for a in coco["annotations"] if a["image_id"] in chosen and a["category_id"] in keep_ids]
    cats=[c for c in coco["categories"] if c["id"] in keep_ids]
    return {"images":images,"annotations":anns,"categories":cats}

def main():
    args=parse_args(); labs=load_json(args.labels_json)
    keep=set(args.classes)
    if is_coco(labs):
        sub=filter_and_sample_coco(labs, keep, args.max_images, args.seed)
    else:
        frames=labs["frames"] if isinstance(labs,dict) and "frames" in labs else labs
        coco_all=to_coco_from_scalabel(frames, args.images_root, keep)
        sub=filter_and_sample_coco(coco_all, keep, args.max_images, args.seed)
    os.makedirs(Path(args.save_json).parent, exist_ok=True)
    json.dump(sub, open(args.save_json,"w",encoding="utf-8"))
    print(f"子集完成：images={len(sub['images'])}, anns={len(sub['annotations'])}, 类别={len(sub['categories'])}")
if __name__=="__main__": main()
PY
chmod +x "$PROJ_ROOT/w1/scripts/make_subset_any.py"

echo "==> 写入 coco_or_scalabel_to_yolo.py（直接转 YOLO，兼容两种标注）"
cat > "$PROJ_ROOT/w1/scripts/coco_or_scalabel_to_yolo.py" <<'PY'
#!/usr/bin/env python
# 将 COCO 或 Scalabel 直接转为 YOLO 文本标注
import os, json, argparse
from pathlib import Path
from collections import defaultdict

def parse_args():
    ap=argparse.ArgumentParser()
    ap.add_argument("--labels-json", required=True)
    ap.add_argument("--images-root", required=True)
    ap.add_argument("--labels-root", required=True)
    ap.add_argument("--classes", nargs="+", required=True)
    return ap.parse_args()

def load_json(p): return json.load(open(p, "r", encoding="utf-8"))
def is_coco(x): return isinstance(x, dict) and all(k in x for k in ["images","annotations","categories"])

def get_wh(p):
    try:
        from PIL import Image
        with Image.open(p) as im: return im.size[0], im.size[1]
    except Exception:
        try:
            import cv2
            im=cv2.imread(str(p)); 
            if im is None: raise RuntimeError
            h,w=im.shape[:2]; return w,h
        except Exception:
            raise SystemExit("无法读取图像尺寸，请安装 pillow 或 opencv-python-headless")

def coco_to_yolo(coco, images_root, labels_root, keep):
    os.makedirs(labels_root, exist_ok=True)
    name2cid={c["name"]:c["id"] for c in coco["categories"]}
    keep=[n for n in keep if n in name2cid]
    name2yid={n:i for i,n in enumerate(keep)}
    keep_cids={name2cid[n] for n in keep}
    by_img=defaultdict(list)
    for a in coco["annotations"]:
        if a.get("category_id") in keep_cids and "bbox" in a:
            by_img[a["image_id"]].append(a)

    cid2name={v:k for k,v in name2cid.items()}
    wh_cache={}
    for img in coco["images"]:
        fn=Path(img.get("file_name")).name
        w,h=img.get("width"), img.get("height")
        if not w or not h:
            p=Path(images_root)/fn
            if fn not in wh_cache: wh_cache[fn]=get_wh(p)
            w,h=wh_cache[fn]
        lines=[]
        for a in by_img.get(img["id"], []):
            name=cid2name.get(a["category_id"])
            if name not in name2yid: continue
            x,y,bw,bh=a["bbox"]
            x_c=(x+bw/2)/w; y_c=(y+bh/2)/h; bw/=w; bh/=h
            lines.append(f"{name2yid[name]} {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f}")
        out=Path(labels_root)/(Path(fn).stem+".txt")
        open(out,"w",encoding="utf-8").write("\n".join(lines))

def scalabel_to_yolo(frames, images_root, labels_root, keep):
    os.makedirs(labels_root, exist_ok=True)
    seen=[]
    for fr in frames:
        for lb in fr.get("labels", []):
            c=lb.get("category")
            if c and c not in seen: seen.append(c)
    keep=[n for n in seen if n in keep]
    name2yid={n:i for i,n in enumerate(keep)}
    for fr in frames:
        name=fr.get("name"); 
        if not name: continue
        fn=Path(name).name
        p=Path(images_root)/fn
        if not p.exists(): p=Path(images_root)/name
        if not p.exists(): continue
        w,h=get_wh(p)
        lines=[]
        for lb in fr.get("labels", []):
            cat=lb.get("category"); b=lb.get("box2d")
            if not b or cat not in name2yid: continue
            x1,y1=float(b.get("x1",0)), float(b.get("y1",0))
            x2,y2=float(b.get("x2",0)), float(b.get("y2",0))
            bw,bh=max(0.0,x2-x1), max(0.0,y2-y1)
            if bw<=1e-6 or bh<=1e-6: continue
            x=(x1+bw/2)/w; y=(y1+bh/2)/h; bw/=w; bh/=h
            lines.append(f"{name2yid[cat]} {x:.6f} {y:.6f} {bw:.6f} {bh:.6f}")
        out=Path(labels_root)/(Path(fn).stem+".txt")
        open(out,"w",encoding="utf-8").write("\n".join(lines))

def main():
    a=parse_args(); d=load_json(a.labels_json); keep=a.classes
    if is_coco(d): coco_to_yolo(d, a.images_root, a.labels_root, keep)
    else:
        frames=d["frames"] if isinstance(d,dict) and "frames" in d else d
        scalabel_to_yolo(frames, a.images_root, a.labels_root, keep)
    print(f"完成：YOLO 标签写入 {a.labels_root}")
if __name__=="__main__": main()
PY
chmod +x "$PROJ_ROOT/w1/scripts/coco_or_scalabel_to_yolo.py"

### ----------------------- 生成 5k 子集 & 转 YOLO -----------------------
echo "==> 生成 train 5k 子集（COCO）"
$RUN python "$PROJ_ROOT/w1/scripts/make_subset_any.py" \
  --labels-json  "$BDD_DIR/labels/det_20/det_train.json" \
  --images-root  "$BDD_DIR/images/100k/train" \
  --save-json    "$BDD_DIR/labels/det_20/det_train_5k.json" \
  --max-images   5000 \
  --classes      car bus truck person bicycle motorcycle "traffic light" "traffic sign"

echo "==> 转 YOLO（train 5k）"
$RUN python "$PROJ_ROOT/w1/scripts/coco_or_scalabel_to_yolo.py" \
  --labels-json "$BDD_DIR/labels/det_20/det_train_5k.json" \
  --images-root "$BDD_DIR/images/100k/train" \
  --labels-root "$BDD_DIR/labels/train" \
  --classes     car bus truck person bicycle motorcycle "traffic light" "traffic sign"

echo "==> 转 YOLO（val 全量，直接从 det_val.json）"
$RUN python "$PROJ_ROOT/w1/scripts/coco_or_scalabel_to_yolo.py" \
  --labels-json "$BDD_DIR/labels/det_20/det_val.json" \
  --images-root "$BDD_DIR/images/100k/val" \
  --labels-root "$BDD_DIR/labels/val" \
  --classes     car bus truck person bicycle motorcycle "traffic light" "traffic sign"

### ----------------------- 生成 train_5k.txt -----------------------
echo "==> 写入 train_5k.txt（绝对路径，最稳）"
$RUN python - <<PY
import json, os, pathlib
subset = r"$BDD_DIR/labels/det_20/det_train_5k.json"
img_root = r"$BDD_DIR/images/100k/train"
d = json.load(open(subset, "r", encoding="utf-8"))
names = {os.path.basename(x["file_name"]) for x in d["images"]}
out = r"$BDD_DIR/train_5k.txt"
with open(out, "w") as f:
    for n in sorted(names):
        f.write(str(pathlib.Path(img_root)/n) + "\n")
print("wrote", len(names), "lines to", out)
PY

### ----------------------- 写 data.yaml -----------------------
echo "==> 写入数据配置 data/bdd100k/bdd5k.yaml"
cat > "$BDD_DIR/bdd5k.yaml" <<YAML
# Week1 dataset config (BDD100K 5k subset + val10k)
path: $BDD_DIR
train: train_5k.txt
val:   images/100k/val
names:
  0: car
  1: bus
  2: truck
  3: person
  4: bicycle
  5: motorcycle
  6: traffic light
  7: traffic sign
YAML

### ----------------------- 清缓存 & 自检 -----------------------
echo "==> 清理 .cache 并快速自检"
rm -f "$BDD_DIR/labels/100k/train.cache" "$BDD_DIR/labels/100k/val.cache" || true
$RUN python - <<'PY'
from glob import glob
print("train txt:", len(glob("data/bdd100k/labels/train/*.txt")))
print("val   txt:", len(glob("data/bdd100k/labels/val/*.txt")))
PY

### ----------------------- 训练 / 验证 / 预测 -----------------------
echo "==> 开始训练（$EPOCHS epochs, imgsz=$TRAIN_IMGSZ, batch=$BATCH, device=$DEVICE）"
$RUN yolo detect train data="$BDD_DIR/bdd5k.yaml" \
  model=yolov8n.pt imgsz="$TRAIN_IMGSZ" epochs="$EPOCHS" batch="$BATCH" workers=8 \
  device="$DEVICE" name="$RUN_NAME"

BEST_PT="$PROJ_ROOT/runs/detect/$RUN_NAME/weights/best.pt"
echo "==> 验证 best.pt: $BEST_PT"
$RUN yolo detect val data="$BDD_DIR/bdd5k.yaml" model="$BEST_PT" imgsz="$TRAIN_IMGSZ" device="$DEVICE" plots=True

echo "==> 导出 ONNX 并做一次推理验证"
$RUN yolo export model="$BEST_PT" format=onnx opset=12
$RUN yolo detect predict source="$BDD_DIR/images/100k/val" \
  model="$PROJ_ROOT/runs/detect/$RUN_NAME/weights/best.onnx" \
  conf=0.25 save=True device="$DEVICE" max_det=300

echo "✅ ALL DONE. 结果目录：runs/detect/$RUN_NAME"

```
