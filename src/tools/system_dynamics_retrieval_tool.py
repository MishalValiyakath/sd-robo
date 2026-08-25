import re
from pathlib import Path

from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from langchain_core.tools import create_retriever_tool


class SimpleLocalRetriever(BaseRetriever):
    """A tiny in-memory retriever for local markdown knowledge."""

    docs: list[Document]

    def _get_relevant_documents(self, query: str) -> list[Document]:
        query_lower = query.lower()
        scored: list[tuple[int, Document]] = []

        for doc in self.docs:
            content = doc.page_content.lower()
            score = content.count(query_lower)
            if score == 0:
                score = sum(content.count(word) for word in re.findall(r"\b\w{4,}\b", query_lower))
            if score > 0:
                scored.append((score, doc))

        if not scored:
            return self.docs[:2]

        scored.sort(key=lambda item: item[0], reverse=True)
        return [doc for _, doc in scored[:3]]


def load_system_dynamics_knowledge_docs() -> list[Document]:
    path = Path(__file__).resolve().parent.parent / "rag_sources" / "system_dynamics_knowledge.md"
    text = path.read_text(encoding="utf-8")
    sections = re.split(r"(?m)^##+\s+", text)

    docs: list[Document] = []
    if sections:
        header = sections[0].strip()
        if header:
            docs.append(Document(page_content=header, metadata={"source": str(path)}))

        for section in sections[1:]:
            section = section.strip()
            if section:
                docs.append(Document(page_content=section, metadata={"source": str(path)}))

    return docs


def create_system_dynamics_retrieval_tool():
    docs = load_system_dynamics_knowledge_docs()
    retriever = SimpleLocalRetriever(docs=docs)
    return create_retriever_tool(
        retriever=retriever,
        name="system_dynamics_knowledge_retriever",
        description="Retrieve system dynamics background for causal model analysis.",
    )
