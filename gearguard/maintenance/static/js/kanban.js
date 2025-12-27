function allowDrop(ev) {
    ev.preventDefault();
}

function drag(ev) {
    ev.dataTransfer.setData("id", ev.target.dataset.id);
}

function drop(ev) {
    ev.preventDefault();
    const id = ev.dataTransfer.getData("id");
    const status = ev.currentTarget.dataset.status;

    fetch("/update/", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({id: id, status: status})
    }).then(() => location.reload());
}
