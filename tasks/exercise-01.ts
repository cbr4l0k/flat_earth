type CardStatus = "drafted" | "published" | "active" | "closed" | "not_now";

type Card = {
    id: string;
    title: string;
    status: CardStatus;
    boardId: string;
    columnId: string | null;
    creatorId: string;
    number: number;
    dueOn: string | null;
    lastActiveAt: number;
    createdAt: number;
}
