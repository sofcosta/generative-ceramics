from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import trimesh
import io
import numpy as np
import itertools
from shapely.geometry import MultiPoint, Point
from scipy.spatial import cKDTree

app = FastAPI()

# Permite comunicação com o frontend (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"mensagem": "Backend is ready!"}

@app.post("/evaluate")
async def evaluate_model(file: UploadFile = File(...)):
    # 1. Carregar a malha STL enviada pelo browser
    # O ficheiro chega como bytes. Usamos o io.BytesIO para fingir que é um ficheiro no disco
    # e o trimesh transforma-o numa malha 3D de polígonos.
    conteudo = await file.read()
    mesh = trimesh.load(io.BytesIO(conteudo), file_type='stl')
    
    # 2. Executar a avaliação modular
    # Chamamos cada função de análise individualmente
    connectivity = evaluate_connectivity(mesh)
    balance = evaluate_balance(mesh)
    overhangs = evaluate_overhangs(mesh)
    permeability = evaluate_permeability(mesh)

    # 3. Empacotar tudo num JSON para o frontend ler e mostrar no painel
    return {
            "connectivity": connectivity,
            "balance": balance, # O balance agora já leva o slenderness lá dentro!
            "overhangs": overhangs,
            "permeability": permeability,
            "mesh_info": {"polygons": len(mesh.faces)}
        }

# ==========================================
# 1. AVALIAÇÃO DE CONECTIVIDADE (PEÇAS SOLTAS)
# ==========================================
def evaluate_connectivity(mesh):
    print ("--- Evaluating Connectivity ---")
    
    # 1. Limpeza Inicial
    # O process() remove vértices duplicados e une faces que partilham as mesmas coordenadas.
    # Isto é crucial porque o gerador pode ter criado faces sobrepostas que o sistema consideraria separadas.
    mesh.process()
    
    # 2. Fragmentação da Malha
    # Tenta separar a peça em múltiplos componentes desconectados.
    # Se a mandala foi gerada com braços demasiado distantes, esta função deteta esses "estilhaços".
    components = mesh.split(only_watertight=False)
    
    # 3. Filtro de Ruído (Garbage Collection)
    total_faces = len(mesh.faces)
    # Considera apenas "peças válidas" aquelas que representam mais de 1% do total de polígonos da cena.
    # Isto ignora poeiras microscópicas (artefactos matemáticos) que o algoritmo de geração possa ter deixado para trás.
    valid_parts = [c for c in components if len(c.faces) > (total_faces * 0.01)]
    part_count = len(valid_parts)

    # Condição de Vitória Rápida: Se depois da filtragem só sobrar 1 peça (ou nenhuma), 
    # a peça é um sólido perfeito e escusamos de gastar poder de processamento no resto da função.
    if part_count <= 1:
        return {"is_solid": True, "part_count": 1, "is_watertight": mesh.is_watertight}

    # 4. Preparação do Grafo de Adjacências
    # Cria um dicionário onde vamos anotar que peça está "colada" a que peça (ex: a peça 0 toca na 2 e na 3)
    adj = {i: [] for i in range(part_count)}
    
    # Define a distância máxima (em mm) para considerarmos que duas peças estão soldadas.
    # Como a malha STL é exportada do site com uma escala x10, 5.0 corresponde a 0.5mm físicos.
    margin = 5.0 
    
    # 5. Otimização Espacial de Alta Velocidade (KD-Trees)
    # Em vez de calcularmos as colisões por força bruta geométrica, criamos uma Árvore KD para cada pedaço válido.
    # A Árvore KD organiza os vértices no espaço 3D de forma hierárquica, permitindo que as pesquisas de proximidade 
    # passem de um tempo O(N^2) para um tempo O(log N) — tornando a análise praticamente instantânea.
    kd_trees = [cKDTree(part.vertices) for part in valid_parts]
    
    # 6. Avaliação Par-a-Par (Combinatória)
    # Testamos todas as peças umas contra as outras (Peça A vs Peça B, Peça A vs Peça C, etc.)
    for i, j in itertools.combinations(range(part_count), 2):
        part_a = valid_parts[i]
        part_b = valid_parts[j]
        
        # Extrai as "Caixas Delimitadoras" (Bounding Boxes) das duas peças.
        bounds_a = part_a.bounds
        bounds_b = part_b.bounds
        
        # 7. Filtro 1: Interseção de Caixas (AABB - Axis-Aligned Bounding Box)
        # Expande as caixas virtuais pela nossa 'margem' de tolerância e verifica se elas se cruzam no espaço.
        # Se as caixas não se tocarem, é fisicamente impossível os vértices tocarem-se. Ignoramos imediatamente.
        overlap = np.all((bounds_a[0] - margin <= bounds_b[1]) & (bounds_a[1] + margin >= bounds_b[0]))
        
        if overlap:
            # 8. Filtro 2: Recorte Espacial com Matrizes NumPy
            # Em vez de enviar todos os 10.000 vértices da Peça B contra a Peça A, usamos operações vetorizadas 
            # ultra-rápidas do NumPy para isolar apenas os vértices da Peça B que invadiram o espaço da Peça A.
            b_verts = part_b.vertices
            
            # Cria máscaras booleanas (True/False) para os eixos X, Y e Z.
            mask_x = (b_verts[:, 0] >= bounds_a[0][0] - margin) & (b_verts[:, 0] <= bounds_a[1][0] + margin)
            mask_y = (b_verts[:, 1] >= bounds_a[0][1] - margin) & (b_verts[:, 1] <= bounds_a[1][1] + margin)
            mask_z = (b_verts[:, 2] >= bounds_a[0][2] - margin) & (b_verts[:, 2] <= bounds_a[1][2] + margin)
            
            # Aplica as máscaras. 'pontos_perigosos' contém agora apenas a pequena minoria de vértices
            # que estão efetivamente na zona de perigo de colisão.
            pontos_perigosos = b_verts[mask_x & mask_y & mask_z]
            
            if len(pontos_perigosos) > 0:
                # 9. Teste de Colisão de Precisão (Query KD-Tree)
                # Disparamos os poucos pontos perigosos da Peça B contra a Árvore da Peça A.
                # O parâmetro 'distance_upper_bound=margin' é vital: faz com que o algoritmo aborte a procura 
                # instantaneamente caso o ponto mais próximo esteja além da distância limite estipulada.
                dists, _ = kd_trees[i].query(pontos_perigosos, k=1, distance_upper_bound=margin)
                
                # Se pelo menos um vértice da peça B estiver a uma distância inferior à margem de um vértice da peça A...
                if np.min(dists) <= margin: 
                    # ...registamos no nosso grafo que estas duas peças estão fundidas numa só.
                    adj[i].append(j)
                    adj[j].append(i)

    # 10. Agrupamento Final (Grafo de Componentes Conexos via BFS)
    # Usamos o algoritmo Breadth-First Search (Pesquisa em Largura) para navegar pelas ligações que descobrimos.
    # O objetivo é contar quantas "ilhas" isoladas de peças existem no final.
    visited = set()
    total_clusters = 0

    for i in range(part_count):
        if i not in visited:
            total_clusters += 1
            queue = [i]
            visited.add(i)
            while queue:
                curr = queue.pop(0)
                # Adiciona todos os vizinhos tocantes à mesma "ilha"
                for neighbor in adj[curr]:
                    if neighbor not in visited:
                        visited.add(neighbor)
                        queue.append(neighbor)

    # 11. Resultado
    # Se todas as sub-peças pertencerem à mesma ilha (cluster único), a mandala é estruturalmente viável.
    return {
        "is_solid": total_clusters == 1,
        "part_count": total_clusters,
        "is_watertight": mesh.is_watertight
    }

# ==========================================
# 2. AVALIAÇÃO DE EQUILIBRIO E ESTABILIDADE (ESTÁTICA)
# ==========================================
def evaluate_balance(mesh):
    print ("--- Evaluating Balance ---")

    # 1. Cálculo do Centro de Massa (CoM) com a biblioteca Trimesh
    # Se a malha for um volume fechado (watertight), usamos o centro de massa real. 
    # Se tiver buracos, fazemos uma aproximação usando o centroide (o ponto médio geométrico).
    com = mesh.center_mass if mesh.is_volume else mesh.centroid
    
    # 2. Identificação do "Chão"
    # O mesh.bounds[0] dá-nos as coordenadas mínimas (X, Y, Z). O índice [2] é o Z mínimo (a base absoluta).
    z_min = mesh.bounds[0][2]
    
    # 3. Extração da Área de Contacto
    # Selecionamos apenas os vértices que estão colados ao chão.
    # Usamos uma tolerância de '+ 1.0' (que equivale a 0.1mm devido à escala x10) para absorver 
    # ligeiras irregularidades geométricas que o gerador possa ter criado na base.
    pontos_base = mesh.vertices[mesh.vertices[:, 2] <= z_min + 1.0]
    
    # Preparamos a altura total em milímetros reais (dividindo a bounding box Z por 10.0) para usar mais à frente.
    height = float(mesh.extents[2] / 10.0) 
    
    # 4. Verificação de Suporte Mínimo
    # Fisicamente, são precisos no mínimo 3 pontos de apoio não-colineares para definir um plano estável (como um tripé).
    # Se a peça tocar no chão apenas num ponto (um bico) ou numa linha (dois pontos), cai automaticamente.
    if len(pontos_base) < 3:
        return {
            "center_of_mass": com.tolist(), 
            "is_stable": False, 
            "margin_mm": 0.0,
            "slenderness_ratio": 99.9, # Atribuímos um risco máximo arbitrário
            "is_slender": True,
            "base_width_mm": 0.0,
            "height_mm": height
        }
    
    # 5. Projeção 2D do Polígono de Suporte
    # Ignoramos a altura (eixo Z) e olhamos para a base de cima para baixo (eixos X e Y).
    base_2d = pontos_base[:, :2]
    
    # O "Convex Hull" (Fecho Convexo) traça o perímetro de segurança extremo em torno de todos os pontos de contacto.
    # Imagina colocar um elástico à volta dos "pés" da peça; o elástico forma o polígono de suporte.
    hull = MultiPoint(base_2d).convex_hull
    
    # 6. Teste da Plumb Line (Linha de Prumo / Vetor Gravitacional)
    # Projetamos o Centro de Massa verticalmente contra o chão (plano XY).
    # Aqui, o CoM atua como Centro de Gravidade.
    com_point = Point(com[0], com[1])
    
    # Se a projeção vertical do Centro de Massa (a gravidade) 
    # cai DENTRO do perímetro de suporte, o objeto não tomba.
    is_stable = hull.contains(com_point)
    
    # 7. Margem de Segurança Física
    # Calcula a distância exata em mm desde a linha de gravidade até à beira mais próxima de tombar.
    margin = hull.exterior.distance(com_point)
    # Se o centro de massa já está fora da base, a peça vai cair. Retornamos a distância como um valor negativo.
    if not is_stable:
        margin = -margin
        
    # ==========================================
    # CÁLCULO DE ESTABILIDADE E CARGA (PASTA/BARRO)
    # ==========================================
    
    # 8. Extrair as dimensões do polígono de suporte (a base)
    # hull.bounds = bounding box da base, dada por (min_x, min_y, max_x, max_y)
    min_x, min_y, max_x, max_y = hull.bounds
    
    # A "largura da base" é a menor dimensão do polígono de suporte (trabalhamos com o lado mais fácil de tombar)
    base_width = min((max_x - min_x), (max_y - min_y)) / 10.0 
    
    # Calcular a Área real do polígono de suporte no chão
    # (Dividimos por 100 porque a área escala ao quadrado: 10 * 10)
    base_area_mm2 = hull.area / 100.0 
    
    # 9. Rácio de Estabilidade (Geometria)
    # Altura total dividida pela largura da base. Quanto mais alto e estreito, mais instável.
    slenderness_ratio = float(height / base_width) if base_width > 0 else 99.9
    
    # 10. Pressão na Base (Risco de Esmagamento)
    # Primeiro calculamos o Volume total da peça em mm³ (dividimos por 1000 porque volume escala ao cubo: 10*10*10)
    # Se a malha tiver buracos (não for um volume fechado), aproximamos usando a casca convexa.
    volume_mm3 = mesh.volume / 1000.0 if mesh.is_volume else mesh.convex_hull.volume / 1000.0
    
    # Rácio de Carga: Volume Total a dividir pela Área da Base.
    # Um valor alto significa muita massa (peso) a pressionar uma área muito pequena de barro fresco.
    load_pressure_ratio = float(volume_mm3 / base_area_mm2) if base_area_mm2 > 0 else 999.9
    
    # 11. Distribuição Vertical de Massa (Top-Heavy)
    # A que altura exata (em mm) se encontra o Centro de Massa em relação ao chão?
    com_z_mm = (com[2] - z_min) / 10.0
    
    # Onde cai esse centro de massa em percentagem da altura total? (0.5 = exatamente a meio)
    mass_distribution = float(com_z_mm / height) if height > 0 else 0.5
                
    # 12. Resultado e Classificação
    return {
        "center_of_mass": com.tolist(), 
        "is_stable": bool(is_stable),
        "margin_mm": float(margin),
        "slenderness_ratio": slenderness_ratio,
        "is_slender": slenderness_ratio > 3.0, 
        
        # --- MÉTRICAS DE CARGA ---
        "base_width_mm": float(base_width),
        "height_mm": float(height),
        "base_area_mm2": float(base_area_mm2),
        "volume_mm3": float(volume_mm3),
        "load_pressure": load_pressure_ratio,
        # Se mais de 55% do peso estiver na metade superior, a peça é "Top-Heavy" (cabeçuda)
        "is_top_heavy": mass_distribution > 0.55, 
        "mass_distribution_ratio": mass_distribution
    }

# ==========================================
# 3. AVALIAÇÃO DE OVERHANGS (SUPORTES DE IMPRESSÃO)
# ==========================================
'''def evaluate_overhangs(mesh, max_angle_degrees=30):
    print ("--- Evaluating Overhangs ---")

    if len(mesh.faces) == 0:
        return {"overhang_ratio": 0.0, "is_printable": False, "risky_triangles": []}
        
    # Definimos que "cima" é o eixo Z positivo.
    up_vector = np.array([0, 0, 1])
    
    # Faz o Produto Escalar (Dot Product) entre a normal (para onde o triângulo aponta) de cada face e o vetor "cima".
    dots = np.dot(mesh.face_normals, up_vector)
    dots = np.clip(dots, -1.0, 1.0) # Garante que os valores ficam entre -1 e 1 por causa de erros de precisão do Python
    
    # O arccos transforma o valor do dot product num ângulo em graus.
    angles = np.degrees(np.arccos(dots)) 
    
    # Subtraímos 90 graus para focar apenas nas faces que estão viradas para baixo (overhangs).
    overhang_angles = angles - 90 
    
    z_min = mesh.bounds[0][2]
    face_centers_z = mesh.triangles_center[:, 2] 
    
    # Ignora os triângulos que estão encostados ao chão (não precisam de suportes porque a cama da impressora os segura).
    is_not_base = face_centers_z > (z_min + 1.0)
    
    # Um triângulo é "crítico" se o seu ângulo for maior que 30º E não estiver no chão.
    is_critical = (overhang_angles > max_angle_degrees) & is_not_base
    
    # Extrai a geometria apenas desses triângulos críticos para enviar para o JavaScript pintar a vermelho.
    triangulos_criticos = mesh.triangles[is_critical].tolist()
    
    # Soma a área de todos os triângulos vermelhos e divide pela área total da peça.
    critical_area = np.sum(mesh.area_faces[is_critical])
    total_area = mesh.area
    
    overhang_ratio = float(critical_area / total_area) if total_area > 0 else 0.0
    
    # Se a área vermelha for menor que 2% do total, a peça ainda é considerada perfeitamente imprimível.
    return {
        "overhang_ratio": overhang_ratio, 
        "is_printable": overhang_ratio < 0.02,
        "risky_triangles": triangulos_criticos 
    }
'''

# ==========================================
# 3. AVALIAÇÃO DE OVERHANGS E TENSÃO DE CARGA
# ==========================================
def evaluate_overhangs(mesh, max_angle_degrees=30):
    print ("--- Evaluating Overhangs & Load Stress ---")

    if len(mesh.faces) == 0:
        return {"overhang_ratio": 0.0, "is_printable": False, "risky_triangles": [], "max_stress_index": 0.0}
        
    # 1. Cálculo de Ângulos
    up_vector = np.array([0, 0, 1])
    dots = np.dot(mesh.face_normals, up_vector)
    dots = np.clip(dots, -1.0, 1.0)
    angles = np.degrees(np.arccos(dots)) 
    overhang_angles = angles - 90 
    
    # 2. Análise Espacial (Altura Z)
    z_min = mesh.bounds[0][2]
    z_max = mesh.bounds[1][2]
    total_height = z_max - z_min
    face_centers_z = mesh.triangles_center[:, 2] 
    
    is_not_base = face_centers_z > (z_min + 1.0)
    '''is_critical_angle = (overhang_angles > max_angle_degrees) & is_not_base'''
    is_not_horizontal_cap = np.abs(mesh.face_normals[:, 2]) < 0.95
    # Detect overhangs in both directions (outside AND inside surfaces)
    is_critical_angle = ((overhang_angles > max_angle_degrees) | (overhang_angles < -max_angle_degrees)) & is_not_base & is_not_horizontal_cap
   
    
    # ==========================================
    # CÁLCULO DE TENSÃO DE CORTE (SHEAR STRESS)
    # ==========================================
    # O Fator de Peso mede a percentagem de peça que existe acima desta face.
    # Se Z max é 20, e a face está a 15, ela só suporta os 5mm do topo (W = 0.25)
    # Se a face está a 5, ela suporta os 15mm acima dela (W = 0.75)
    weight_factors = (z_max - face_centers_z) / total_height
    
    # O Fator de Ângulo normaliza a inclinação para um risco de 0 a 1.
    # Use absolute value to treat inward and outward angles equally
    angle_factors = np.abs(overhang_angles) / 90.0
    
    # O Índice de Tensão é a multiplicação do Peso pela Inclinação
    stress_array = weight_factors * angle_factors
    
    # Extraímos os valores de stress apenas para os triângulos já considerados como "overhang"
    critical_stress = stress_array[is_critical_angle]
    
    # Qual é a zona de maior perigo da peça inteira?
    max_stress = float(np.max(critical_stress)) if len(critical_stress) > 0 else 0.0
    
    # 3. Empacotamento do Mapa de Calor (Heatmap) para o Frontend
    # Encontra os índices de todos os triângulos que estão demasiado inclinados
    critical_indices = np.where(is_critical_angle)[0]
    
    heatmap_data = []
    for idx in critical_indices:
        heatmap_data.append({
            "vertices": mesh.triangles[idx].tolist(),
            "stress": float(stress_array[idx])
        })
    
    # Mantemos a lógica antiga de avaliar se falha a impressão para o painel de texto
    is_failing_structurally = is_critical_angle & (stress_array > 0.35)
    critical_area = np.sum(mesh.area_faces[is_failing_structurally])
    total_area = mesh.area
    overhang_ratio = float(critical_area / total_area) if total_area > 0 else 0.0
    
    # 4. Verificação Final de Viabilidade
    is_printable = (overhang_ratio < 0.02) and (max_stress < 0.45)
    
    return {
        "overhang_ratio": overhang_ratio, 
        "max_stress_index": max_stress,
        "is_printable": is_printable,
        "stress_heatmap": heatmap_data  
    }

# ==========================================
# 4. AVALIAÇÃO DE POROSIDADE (LUZ / ESPAÇOS VAZIOS)
# ==========================================
def evaluate_permeability(mesh, resolution=50):
    print ("--- Evaluating Permeability ---")

    hull = mesh.convex_hull # Uma casca exterior invisível simplificada da peça
    bounds = mesh.bounds
    
    # Função interna que simula disparar uma grelha de lasers através da peça
    def shoot_rays_porosity(axis_idx, p1_idx, p2_idx, is_side=False):
        p1_min, p1_max = bounds[0][p1_idx], bounds[1][p1_idx]
        
        if is_side:
            # Se for luz lateral, foca os lasers apenas nos 50% do centro da peça.
            # Isto ignora as bordas arredondadas e avalia o verdadeiro "miolo" da mandala.
            width = p1_max - p1_min
            p1 = np.linspace(p1_min + (width * 0.25), p1_max - (width * 0.25), resolution)
        else:
            p1 = np.linspace(p1_min, p1_max, resolution)
            
        p2 = np.linspace(bounds[0][p2_idx], bounds[1][p2_idx], resolution)
        grid_1, grid_2 = np.meshgrid(p1, p2)
        
        # Define as origens dos lasers (como se fosse um painel LED quadrado fora da peça)
        origins = np.zeros((resolution**2, 3))
        origins[:, p1_idx] = grid_1.flatten()
        origins[:, p2_idx] = grid_2.flatten()
        origins[:, axis_idx] = bounds[0][axis_idx] - 5.0
        
        # A direção dos lasers vai ser reta num único eixo
        directions = np.zeros((resolution**2, 3))
        directions[:, axis_idx] = 1.0
        
        # 1º Passo: Dispara contra a "casca" exterior invisível (Hull).
        # Isto diz-nos quantos lasers acertariam na peça se ela fosse um bloco maciço perfeito.
        hits_hull = hull.ray.intersects_any(origins, directions)
        total_hull_hits = np.sum(hits_hull)
        
        if total_hull_hits == 0: 
            return 0.0
            
        # 2º Passo: Desses lasers válidos, quantos é que acertam na malha REAL da mandala?
        valid_origins = origins[hits_hull]
        valid_directions = directions[hits_hull]
        hits_mesh = mesh.ray.intersects_any(valid_origins, valid_directions)
        total_mesh_hits = np.sum(hits_mesh)
        
        # Se a malha real tiver menos impactos que a casca maciça, a diferença são os buracos (luz que passou direta).
        buracos = total_hull_hits - total_mesh_hits
        return float(buracos / total_hull_hits) # Rácio de luz que atravessa a peça.

    # Simula luz a bater de cima (Z)
    light_top   = shoot_rays_porosity(2, 0, 1, is_side=False) 
    
    # Simula luz a bater de frente (Y) e de lado (X)
    light_front = shoot_rays_porosity(1, 0, 2, is_side=True) 
    light_side  = shoot_rays_porosity(0, 1, 2, is_side=True) 
    
    # Fica com o valor mais alto. Se a peça for muito aberta num ângulo mas fechada noutro, é considerada "Aberta".
    return {
        "max_light_pass": float(max(light_front, light_side, light_top)),
        "top_pass": float(light_top),
        "side_pass": float(light_side)
    }