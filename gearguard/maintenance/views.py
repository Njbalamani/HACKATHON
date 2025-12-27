from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Count
import json
from django.contrib.auth.decorators import login_required
from django.http import HttpResponseForbidden
from django.shortcuts import redirect, get_object_or_404
from .models import (
    MaintenanceRequest,
    Equipment,
    MaintenanceTeam
)

@login_required
def kanban_board(request):
    requests = MaintenanceRequest.objects.all()

    stages = [
        "New",
        "In Progress",
        "Repaired",
        "Scrap"
    ]
    is_maintenance = request.user.groups.filter(
        name="MaintenanceTeam"
    ).exists()

    return render(request, 'maintenance/kanban.html', {
        'requests': requests,
        'stages': stages,
        'is_maintenance': is_maintenance
    })



@csrf_exempt
def update_status(request):
    data = json.loads(request.body)
    req = MaintenanceRequest.objects.get(id=data['id'])
    req.status = data['status']
    req.save()

    # Scrap logic
    if data['status'] == 'Scrap':
        eq = req.equipment
        eq.is_scrapped = True
        eq.save()

    return JsonResponse({'success': True})


def create_request(request):
    if request.method == 'POST':
        MaintenanceRequest.objects.create(
            subject=request.POST['subject'],
            equipment_id=request.POST['equipment'],
            team_id=request.POST['team'],
            request_type=request.POST['request_type'],
            scheduled_date=request.POST.get('scheduled_date') or None
        )

    return render(request, 'maintenance/form.html', {
        'equipment': Equipment.objects.all(),
        'teams': MaintenanceTeam.objects.all()
    })


def calendar_view(request):
    preventive = MaintenanceRequest.objects.filter(
        request_type='Preventive'
    )
    return render(request, 'maintenance/calender.html', {
        'requests': preventive
    })

def dashboard(request):
    return render(request, 'maintenance/dashboard.html', {
        'total_requests': MaintenanceRequest.objects.count(),
        'new': MaintenanceRequest.objects.filter(status='New').count(),
        'progress': MaintenanceRequest.objects.filter(status='In Progress').count(),
        'done': MaintenanceRequest.objects.filter(status='Repaired').count(),
        'scrap': MaintenanceRequest.objects.filter(status='Scrap').count(),
        'equipment': Equipment.objects.count(),
        'teams': MaintenanceTeam.objects.count(),
    })


@login_required
def update_request(request, pk):
    req = get_object_or_404(MaintenanceRequest, pk=pk)
    if request.GET.get('status'):
        if not request.user.groups.filter(name='MaintenanceTeam').exists():
            return HttpResponseForbidden("Only maintenance team can do this")

        req.status = request.GET.get('status')
        req.save()
        return redirect('/')

    if request.method == 'POST':
        req.subject = request.POST['subject']
        req.request_type = request.POST['request_type']

        if request.user.groups.filter(name='MaintenanceTeam').exists():
            req.status = request.POST['status']

        req.save()
        return redirect('/')

    return render(request, 'maintenance/update.html', {'req': req})

def delete_request(request, pk):
    if not request.user.groups.filter(name='MaintenanceTeam').exists():
        return HttpResponseForbidden("You are not allowed to delete requests")

    req = get_object_or_404(MaintenanceRequest, pk=pk)
    req.delete()
    return redirect('/')