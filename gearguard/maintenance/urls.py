from django.urls import path
from .views import (
    kanban_board,
    create_request,
    update_request,
    delete_request,
    calendar_view
)

urlpatterns = [
    path('', kanban_board),
    path('create/', create_request),
    path('new-request/',create_request, name='new_request'),
    path('update/<int:pk>/', update_request),
    path('delete/<int:pk>/', delete_request),
    path('calendar/', calendar_view),
]
