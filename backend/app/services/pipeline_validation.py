from typing import Dict, List, Set, Optional
from collections import defaultdict

from app.domain.schemas.pipeline import (
    PipelineGraph,
    PipelineNode,
    PipelineEdge,
    PipelineValidationError,
    CycleDetectionError,
)


def build_adjacency(graph: PipelineGraph) -> Dict[str, List[str]]:
    """
    Build adjacency list from pipeline graph edges.
    Returns a dictionary mapping each node ID to its downstream neighbors.
    """
    adjacency: Dict[str, List[str]] = defaultdict(list)

    for edge in graph.edges:
        adjacency[edge.source].append(edge.target)

    return adjacency


def detect_cycle(graph: PipelineGraph) -> Optional[List[str]]:
    """
    Detect cycles in the pipeline graph using DFS.
    Returns the cycle path if a cycle is found, otherwise None.
    """
    adjacency = build_adjacency(graph)
    all_nodes = {node.id for node in graph.nodes}

    visited: Set[str] = set()
    rec_stack: Set[str] = set()
    parent: Dict[str, Optional[str]] = {node.id: None for node in graph.nodes}

    def dfs(node: str, path: List[str]) -> Optional[List[str]]:
        visited.add(node)
        rec_stack.add(node)

        for neighbor in adjacency.get(node, []):
            if neighbor not in visited:
                parent[neighbor] = node
                result = dfs(neighbor, path + [neighbor])
                if result:
                    return result
            elif neighbor in rec_stack:
                # Found a cycle, reconstruct the cycle path
                cycle_start = neighbor
                cycle: List[str] = [cycle_start]

                current = node
                while current != cycle_start:
                    cycle.append(current)
                    current = parent.get(current)
                    if current is None:
                        break

                cycle.append(cycle_start)
                cycle.reverse()
                return cycle

        rec_stack.remove(node)
        return None

    for node_id in all_nodes:
        if node_id not in visited:
            result = dfs(node_id, [node_id])
            if result:
                return result

    return None


def validate_pipeline(graph: PipelineGraph) -> bool:
    """
    Validate a pipeline graph for structural correctness.

    Raises:
        PipelineValidationError: If validation fails
        CycleDetectionError: If a cycle is detected
    """
    if not graph.nodes:
        raise PipelineValidationError(
            "Pipeline must contain at least one node",
            {"node_count": len(graph.nodes)}
        )

    node_ids = {node.id for node in graph.nodes}

    input_nodes = [
        node for node in graph.nodes
        if node.type == "input" and len([
            edge for edge in graph.edges if edge.target == node.id
        ]) == 0
    ]

    if len(input_nodes) != 1:
        raise PipelineValidationError(
            f"Pipeline must have exactly one input node, found {len(input_nodes)}",
            {"input_nodes": [node.id for node in input_nodes]}
        )

    output_nodes = [
        node for node in graph.nodes
        if node.type == "output" and len([
            edge for edge in graph.edges if edge.source == node.id
        ]) == 0
    ]

    if len(output_nodes) < 1:
        raise PipelineValidationError(
            "Pipeline must have at least one output node",
            {"output_nodes": [node.id for node in output_nodes]}
        )

    for edge in graph.edges:
        if edge.source not in node_ids:
            raise PipelineValidationError(
                f"Edge source node '{edge.source}' does not exist in graph",
                {"edge_id": edge.id}
            )
        if edge.target not in node_ids:
            raise PipelineValidationError(
                f"Edge target node '{edge.target}' does not exist in graph",
                {"edge_id": edge.id}
            )

    cycle = detect_cycle(graph)
    if cycle:
        raise CycleDetectionError(cycle_path=cycle)

    return True


def validate_node_connectivity(graph: PipelineGraph) -> Dict[str, bool]:
    """
    Validate that all nodes (except input) have incoming connections
    and all nodes (except output) have outgoing connections.
    """
    connectivity: Dict[str, bool] = {}

    adjacency = build_adjacency(graph)
    reverse_adjacency: Dict[str, List[str]] = defaultdict(list)

    for edge in graph.edges:
        reverse_adjacency[edge.target].append(edge.source)

    for node in graph.nodes:
        has_incoming = len(reverse_adjacency.get(node.id, [])) > 0
        has_outgoing = len(adjacency.get(node.id, [])) > 0

        is_input = node.type == "input"
        is_output = node.type == "output"

        if is_input:
            connectivity[node.id] = not has_incoming
        elif is_output:
            connectivity[node.id] = has_outgoing
        else:
            connectivity[node.id] = has_incoming and has_outgoing

    return connectivity
