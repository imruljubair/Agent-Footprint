function isUserRequest(event) {
  return event?.type === "event_msg" && event.payload?.type === "user_message" && event.payload?.message?.trim();
}

export function userRequestSegments(events, sessionId) {
  const requests = events.map((event, index) => ({ event, index })).filter(({ event }) => isUserRequest(event));
  return requests.map(({ event, index }, ordinal) => {
    const endIndex = requests[ordinal + 1]?.index ?? events.length;
    const segmentEvents = events.slice(index, endIndex);
    const completeEvent = segmentEvents.find((item) => item.type === "event_msg" && item.payload?.type === "task_complete");
    const activityCount = segmentEvents.filter((item) => item.type === "response_item" && ["custom_tool_call", "function_call"].includes(item.payload?.type)).length;
    return {
      id: `${sessionId}:request:${index}`,
      event,
      startIndex: index,
      endIndex,
      requestAt: event.timestamp,
      updatedAt: completeEvent?.timestamp || segmentEvents.at(-1)?.timestamp || event.timestamp,
      status: completeEvent || endIndex < events.length ? "complete" : "working",
      activityCount,
    };
  });
}
