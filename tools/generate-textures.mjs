/**
 * Generación de texturas con ComfyUI vía su API HTTP.
 *
 * No es parte de la app: es una herramienta de authoring. Se ejecuta una vez
 * para producir las texturas de `public/textures/`, y la app las consume como
 * ficheros estáticos. Así la app no depende de ComfyUI en runtime.
 *
 * Uso:
 *   node tools/generate-textures.mjs            # todas
 *   node tools/generate-textures.mjs floor      # solo una
 *
 * Requiere ComfyUI listening (run_nvidia_gpu.bat) y un checkpoint en
 * models/checkpoints.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const COMFY = process.env.COMFY_URL ?? 'http://127.0.0.1:8188';
const OUT = path.resolve('public/textures');

/**
 * Cada textura define su prompt yNegativo. El punto clave es "seamless /
 * tileable": sin eso la textura tiene bordes visibles y al repetir en el suelo
 * se nota el corte.
 */
const TEXTURES = {
  floor: {
    file: 'floor_metal.png',
    size: 1024,
    steps: 30,
    // "wet"/"reflective" hace que SD 1.5 devuelva agua. Aqui interesa chapa
    // mate: metal uniformemente iluminado y sin liquido.
    prompt:
      'seamless tileable texture of dark grey industrial metal floor plating, ' +
      'flat matte surface, straight panel seams forming a regular grid, subtle screws, ' +
      'slight scuffing, even diffuse lighting, no reflections, ' +
      'photorealistic, top-down orthographic view, 8k detail',
    negative:
      'water, liquid, ripples, waves, puddle, wet, reflective, mirror, ' +
      'visible seams at border, frame, text, watermark, perspective, vignette, ' +
      'blurry, low detail, cartoon, people, objects',
  },
  wall: {
    file: 'wall_panel.png',
    size: 1024,
    steps: 28,
    prompt:
      'seamless tileable texture of futuristic laboratory wall panel, brushed gunmetal plating, ' +
      'recessed rectangular sections, small hex bolts, faint cyan emissive indicator strips, ' +
      'scuffed metal, photorealistic, flat front view, evenly lit, 8k detail',
    negative:
      'visible seams, borders, frame, text, watermark, perspective, heavy grunge, ' +
      'blurry, cartoon, people',
  },
  pillar: {
    file: 'pillar_metal.png',
    size: 512,
    steps: 24,
    prompt:
      'seamless tileable texture of dark machined metal column, vertical brushed grain, ' +
      'subtle panel seams and rivets, industrial sci-fi, photorealistic, flat view, evenly lit',
    negative: 'visible seams, borders, frame, text, watermark, perspective, blurry, cartoon',
  },
  panel: {
    file: 'panel_dark.png',
    size: 512,
    steps: 24,
    prompt:
      'seamless tileable texture of dark anodized aluminum equipment casing, fine noise grain, ' +
      'slight wear at edges, sci-fi laboratory hardware, photorealistic, flat view, evenly lit',
    negative: 'visible seams, borders, frame, text, watermark, perspective, blurry, cartoon',
  },
};

/** Construye el workflow en el formato API de ComfyUI. */
function buildWorkflow({ size, steps, prompt, negative, checkpoint }) {
  return {
    1: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    2: {
      class_type: 'CLIPTextEncode',
      inputs: { text: prompt, clip: ['1', 1] },
    },
    3: {
      class_type: 'CLIPTextEncode',
      inputs: { text: negative, clip: ['1', 1] },
    },
    4: {
      class_type: 'EmptyLatentImage',
      inputs: { width: size, height: size, batch_size: 1 },
    },
    5: {
      class_type: 'KSampler',
      inputs: {
        seed: Math.floor(Math.random() * 2 ** 31),
        steps,
        cfg: 7,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    6: {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    7: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'studyforge', images: ['6', 0] },
    },
  };
}

async function api(pathname, body) {
  const res = await fetch(`${COMFY}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function waitForHistory(promptId, timeoutMs = 10 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${COMFY}/history/${promptId}`);
    const history = await res.json();
    if (history[promptId]?.outputs?.[7]?.images?.length) {
      return history[promptId].outputs[7].images[0];
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('tiempo agotado esperando la generacion');
}

async function main() {
  const only = process.argv.slice(2);
  const targets = only.length ? only : Object.keys(TEXTURES);

  // Comprobar que hay checkpoint cargado.
  const info = await (await fetch(`${COMFY}/object_info/CheckpointLoaderSimple`)).json();
  const options = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
  if (options.length === 0) {
    console.error('No hay checkpoints en models/checkpoints. Descarga uno y reinicia ComfyUI.');
    process.exit(1);
  }
  const checkpoint = options[0];
  console.log(`checkpoint: ${checkpoint}`);
  console.log(`comfy: ${COMFY}`);

  await mkdir(OUT, { recursive: true });

  for (const key of targets) {
    const spec = TEXTURES[key];
    if (!spec) {
      console.error(`textura desconocida: ${key}`);
      continue;
    }
    const target = path.join(OUT, spec.file);
    if (existsSync(target) && !process.env.FORCE) {
      console.log(`- ${key}: ya existe, se omite`);
      continue;
    }

    console.log(`- ${key}: generando ${spec.size}x${spec.size}...`);
    const { prompt_id } = await api('/prompt', {
      prompt: buildWorkflow({ ...spec, checkpoint }),
    });
    const image = await waitForHistory(prompt_id);
    const blob = await (await fetch(`${COMFY}/view?${image.subfolder ? 'subfolder=' + image.subfolder + '&' : ''}filename=${image.filename}`)).blob();
    await writeFile(target, Buffer.from(await blob.arrayBuffer()));
    console.log(`  -> ${target}`);
  }

  console.log('listo');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
